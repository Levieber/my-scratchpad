// The OAuth 2.1 authorization server in front of /mcp, as the MCP authorization spec asks of a
// remote server: protected-resource metadata (RFC 9728), server metadata (RFC 8414), dynamic
// client registration (RFC 7591), the authorization code flow with PKCE S256 only, refresh tokens
// rotated on use, and access tokens bound to this server's /mcp (RFC 8707). Its errors are
// OAuth's (`{ error, error_description }`), not the API's: OAuth clients read those.
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import { ERROR_MESSAGES } from "@/shared/errors";

import { consentHeaders, consentPage, errorPage } from "./consent";
import {
  ACCESS_TTL_S,
  AUTH_METHODS,
  type AuthMethod,
  type ClientInfo,
  fingerprint,
  type Grant,
  makeSigner,
  randomToken,
  REFRESH_TTL_S,
  s256,
  sameSecret,
  SCOPE,
} from "./tokens";

export const MCP_PATH = "/mcp";

// Where claude.ai (web, desktop and mobile alike) sends the person back to. Loopback addresses are
// how a client on the person's own machine (Claude Code, the MCP Inspector) receives the code; a
// page elsewhere can never receive one, even with a phished approval.
const CLAUDE_CALLBACKS = [
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
];
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export const allowedRedirect = (uri: string) => {
  if (CLAUDE_CALLBACKS.includes(uri)) return true;
  try {
    const url = new URL(uri);
    return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname) && !url.hash;
  } catch {
    return false;
  }
};

// RFC 7636: 43 to 128 unreserved characters, for the verifier and (base64url of a SHA-256) the
// challenge alike.
const PKCE = /^[\w.~-]{43,128}$/;

const CODE_TTL_MS = 5 * 60 * 1000;
const MAX_REDIRECTS = 10;
const NO_STORE = { "cache-control": "no-store", pragma: "no-cache" };

type Code = {
  cid: string;
  redirectUri: string;
  challenge: string;
  expiresAt: number;
};

const oauthError = (
  status: number,
  error: string,
  description: string,
  headers: Record<string, string> = {},
) =>
  HttpServerResponse.jsonUnsafe(
    { error, error_description: description },
    { status, headers: { ...NO_STORE, ...headers } },
  );

const html = (body: string, status: number, headers: Record<string, string>) =>
  HttpServerResponse.text(body, { status, contentType: "text/html; charset=utf-8", headers });

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** `client_id:client_secret` from HTTP Basic, each form-encoded as RFC 6749 §2.3.1 asks. */
const basicCredentials = (header: string | undefined) => {
  const match = /^Basic\s+(\S+)$/i.exec(header ?? "");
  if (!match?.[1]) return undefined;
  const decoded = Buffer.from(match[1], "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  if (colon < 0) return undefined;
  try {
    const decode = (part: string) => decodeURIComponent(part.replace(/\+/g, " "));
    return { id: decode(decoded.slice(0, colon)), secret: decode(decoded.slice(colon + 1)) };
  } catch {
    return undefined;
  }
};

// A request body that can't be read is the client's problem; anything else is ours, and logged.
const guarded = <E, R>(
  handler: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, R> =>
  handler.pipe(
    Effect.catch(() => Effect.succeed(oauthError(400, "invalid_request", "Unreadable request"))),
    Effect.catchDefect((defect) =>
      Effect.as(
        Effect.logError("oauth", defect),
        oauthError(500, "server_error", "Internal error"),
      ),
    ),
  );

export const makeOAuth = ({
  publicUrl,
  ownerToken,
  secret,
}: {
  /** This server's origin: the issuer, and the resource is `/mcp` on it. */
  publicUrl: string;
  /** PAD_TOKEN: what the owner types to approve a connector. */
  ownerToken: string;
  secret: string;
}) => {
  const signer = makeSigner(secret);
  const resource = `${publicUrl}${MCP_PATH}`;
  const resourceMetadataUrl = `${publicUrl}/.well-known/oauth-protected-resource${MCP_PATH}`;
  // Codes live a few minutes and are spent once, so memory is enough: a redeploy in between costs
  // one retry of the approval.
  const codes = new Map<string, Code>();

  // A client names the resource as it was given it; a trailing slash or the bare origin is still
  // this server.
  const isThisResource = (value: string | null) =>
    value === null || [resource, publicUrl].includes(value.replace(/\/+$/, ""));

  const protectedResource = HttpServerResponse.jsonUnsafe({
    resource,
    authorization_servers: [publicUrl],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Scratchpad",
  });

  const authorizationServer = HttpServerResponse.jsonUnsafe({
    issuer: publicUrl,
    authorization_endpoint: `${publicUrl}/authorize`,
    token_endpoint: `${publicUrl}/token`,
    registration_endpoint: `${publicUrl}/register`,
    scopes_supported: [SCOPE],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: AUTH_METHODS,
    authorization_response_iss_parameter_supported: true,
  });

  const register = Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest;
    const text = yield* req.text;
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return oauthError(400, "invalid_client_metadata", "The body must be JSON");
    }
    if (!isObject(body))
      return oauthError(400, "invalid_client_metadata", "The body must be a JSON object");
    const uris = body.redirect_uris;
    // Registration is open to anyone, and the client id carries the list: keep it short.
    if (
      !Array.isArray(uris) ||
      uris.length === 0 ||
      uris.length > MAX_REDIRECTS ||
      !uris.every((u): u is string => typeof u === "string" && u.length <= 2048)
    )
      return oauthError(
        400,
        "invalid_redirect_uri",
        `redirect_uris must be a list of 1 to ${MAX_REDIRECTS} URLs`,
      );
    const refused = uris.find((u) => !allowedRedirect(u));
    if (refused !== undefined)
      return oauthError(
        400,
        "invalid_redirect_uri",
        `${refused} is not allowed: this server sends codes only to claude.ai and to loopback addresses`,
      );
    // RFC 7591's default is client_secret_basic.
    const auth = body.token_endpoint_auth_method ?? "client_secret_basic";
    if (!AUTH_METHODS.includes(auth as AuthMethod))
      return oauthError(
        400,
        "invalid_client_metadata",
        `token_endpoint_auth_method must be one of ${AUTH_METHODS.join(", ")}`,
      );
    const name =
      typeof body.client_name === "string" ? body.client_name.trim().slice(0, 100) : undefined;
    const iat = Math.floor((yield* Clock.currentTimeMillis) / 1000);
    const info: ClientInfo = {
      redirect_uris: uris,
      auth: auth as AuthMethod,
      iat,
      jti: randomToken(16),
    };
    if (name) info.name = name;
    const clientId = signer.sign("client", info);
    yield* Effect.logInfo("oauth client registered").pipe(
      Effect.annotateLogs({ client: name ?? "unnamed", redirectUris: uris }),
    );
    return HttpServerResponse.jsonUnsafe(
      {
        client_id: clientId,
        client_id_issued_at: iat,
        ...(info.auth !== "none" && {
          client_secret: signer.clientSecret(clientId),
          client_secret_expires_at: 0,
        }),
        ...(name && { client_name: name }),
        redirect_uris: uris,
        token_endpoint_auth_method: info.auth,
        // What this server grants whatever was asked for (RFC 7591 lets it replace them).
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        scope: SCOPE,
      },
      { status: 201, headers: NO_STORE },
    );
  });

  type Checked =
    | { _tag: "Page"; message: string }
    | { _tag: "Redirect"; redirectUri: string; error: string; description: string; state?: string }
    | {
        _tag: "Ok";
        clientId: string;
        client: ClientInfo;
        redirectUri: string;
        challenge: string;
        state?: string;
        /** The request as the consent form carries it to the POST. */
        params: Record<string, string>;
      };

  // The same checks for the page (GET) and the answer (POST). Until the client and its redirect are
  // known to be genuine nothing may go back to it; after that, errors go back to it (RFC 6749
  // §4.1.2.1).
  const checkAuthorization = (q: URLSearchParams): Checked => {
    const clientId = q.get("client_id") ?? "";
    const client = signer.verify("client", clientId);
    if (!client)
      return {
        _tag: "Page",
        message: "The app asking isn't registered with this server. Remove it and connect again.",
      };
    const asked = q.get("redirect_uri");
    const redirectUri =
      asked ?? (client.redirect_uris.length === 1 ? client.redirect_uris[0] : undefined);
    if (!redirectUri || !client.redirect_uris.includes(redirectUri))
      return {
        _tag: "Page",
        message: "The app asked to be sent back to an address it didn't register.",
      };
    const state = q.get("state") ?? undefined;
    const back = (error: string, description: string): Checked => ({
      _tag: "Redirect",
      redirectUri,
      error,
      description,
      ...(state !== undefined && { state }),
    });
    if (q.get("response_type") !== "code")
      return back("unsupported_response_type", "Only the authorization code flow is supported");
    const challenge = q.get("code_challenge") ?? "";
    if (q.get("code_challenge_method") !== "S256" || !PKCE.test(challenge))
      return back("invalid_request", "PKCE with code_challenge_method S256 is required");
    if (!isThisResource(q.get("resource")))
      return back("invalid_target", `This server only grants access to ${resource}`);
    const params: Record<string, string> = {
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: "S256",
    };
    if (state !== undefined) params.state = state;
    const asResource = q.get("resource");
    if (asResource !== null) params.resource = asResource;
    return {
      _tag: "Ok",
      clientId,
      client,
      redirectUri,
      challenge,
      params,
      ...(state !== undefined && { state }),
    };
  };

  const redirectTo = (redirectUri: string, params: Record<string, string | undefined>) => {
    const url = new URL(redirectUri);
    for (const [name, value] of Object.entries(params))
      if (value !== undefined) url.searchParams.set(name, value);
    url.searchParams.set("iss", publicUrl);
    // 303: the browser follows a POST's answer with a GET.
    return HttpServerResponse.redirect(url, { status: 303, headers: NO_STORE });
  };

  const notOk = (checked: Exclude<Checked, { _tag: "Ok" }>) =>
    checked._tag === "Page"
      ? html(errorPage(checked.message), 400, { "cache-control": "no-store" })
      : redirectTo(checked.redirectUri, {
          error: checked.error,
          error_description: checked.description,
          state: checked.state,
        });

  const authorizePage = Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest;
    const checked = checkAuthorization(new URL(req.originalUrl, publicUrl).searchParams);
    if (checked._tag !== "Ok") return notOk(checked);
    return html(
      consentPage({
        clientName: checked.client.name,
        redirectUri: checked.redirectUri,
        params: checked.params,
      }),
      200,
      consentHeaders(checked.redirectUri),
    );
  });

  const authorizeAnswer = Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest;
    const form = new URLSearchParams(yield* req.text);
    const checked = checkAuthorization(form);
    if (checked._tag !== "Ok") return notOk(checked);
    const who = checked.client.name ?? "unnamed";
    if (form.get("decision") !== "allow") {
      yield* Effect.logInfo("oauth approval denied").pipe(Effect.annotateLogs({ client: who }));
      return redirectTo(checked.redirectUri, {
        error: "access_denied",
        error_description: "The owner denied access",
        state: checked.state,
      });
    }
    if (!sameSecret(form.get("token") ?? "", ownerToken)) {
      yield* Effect.logWarning("oauth approval refused: wrong token").pipe(
        Effect.annotateLogs({ client: who }),
      );
      return html(
        consentPage({
          clientName: checked.client.name,
          redirectUri: checked.redirectUri,
          params: checked.params,
          error: "That isn't this server's PAD_TOKEN.",
        }),
        401,
        consentHeaders(checked.redirectUri),
      );
    }
    const now = yield* Clock.currentTimeMillis;
    for (const [code, entry] of codes) if (entry.expiresAt <= now) codes.delete(code);
    const code = randomToken();
    codes.set(code, {
      cid: fingerprint(checked.clientId),
      redirectUri: checked.redirectUri,
      challenge: checked.challenge,
      expiresAt: now + CODE_TTL_MS,
    });
    yield* Effect.logInfo("oauth approval granted").pipe(
      Effect.annotateLogs({ client: who, redirectHost: new URL(checked.redirectUri).host }),
    );
    return redirectTo(checked.redirectUri, { code, state: checked.state });
  });

  const tokens = (cid: string, now: number) => {
    const seconds = Math.floor(now / 1000);
    const grant = (ttl: number): Grant => ({
      cid,
      aud: resource,
      scope: SCOPE,
      exp: seconds + ttl,
      jti: randomToken(16),
    });
    return HttpServerResponse.jsonUnsafe(
      {
        access_token: signer.sign("access", grant(ACCESS_TTL_S)),
        token_type: "Bearer",
        expires_in: ACCESS_TTL_S,
        refresh_token: signer.sign("refresh", grant(REFRESH_TTL_S)),
        scope: SCOPE,
      },
      { headers: NO_STORE },
    );
  };

  const token = Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest;
    const form = new URLSearchParams(yield* req.text);
    const basic = basicCredentials(req.headers.authorization);
    const challenge = basic ? { "www-authenticate": 'Basic realm="scratchpad"' } : undefined;
    if (basic && form.has("client_id") && form.get("client_id") !== basic.id)
      return oauthError(400, "invalid_request", "Two different client ids");
    const clientId = basic?.id ?? form.get("client_id") ?? "";
    const client = signer.verify("client", clientId);
    if (!client)
      return oauthError(401, "invalid_client", "Unknown client: connect again", challenge);
    if (client.auth !== "none") {
      const secret = basic?.secret ?? form.get("client_secret") ?? "";
      if (!sameSecret(secret, signer.clientSecret(clientId)))
        return oauthError(401, "invalid_client", "Wrong client secret", challenge);
    }
    const cid = fingerprint(clientId);
    const now = yield* Clock.currentTimeMillis;
    if (!isThisResource(form.get("resource")))
      return oauthError(400, "invalid_target", `This server only grants access to ${resource}`);

    switch (form.get("grant_type")) {
      case "authorization_code": {
        const code = form.get("code") ?? "";
        const entry = codes.get(code);
        // Spent whatever happens next: a code is good for one try.
        codes.delete(code);
        const verifier = form.get("code_verifier") ?? "";
        const redirectUri = form.get("redirect_uri");
        if (
          !entry ||
          entry.expiresAt <= now ||
          entry.cid !== cid ||
          (redirectUri !== null && redirectUri !== entry.redirectUri) ||
          !PKCE.test(verifier) ||
          !sameSecret(s256(verifier), entry.challenge)
        )
          return oauthError(400, "invalid_grant", "The code is unknown, expired or not yours");
        return tokens(cid, now);
      }
      case "refresh_token": {
        const grant = signer.verify("refresh", form.get("refresh_token") ?? "");
        if (!grant || grant.exp * 1000 <= now || grant.cid !== cid || grant.aud !== resource)
          return oauthError(
            400,
            "invalid_grant",
            "The refresh token is unknown, expired or not yours",
          );
        return tokens(cid, now);
      }
      default:
        return oauthError(
          400,
          "unsupported_grant_type",
          "grant_type must be authorization_code or refresh_token",
        );
    }
  });

  // Annotated: inferred from a mixed list, the requirements would widen to any.
  const all: ReadonlyArray<HttpRouter.Route<never, never>> = [
    HttpRouter.route("GET", "/.well-known/oauth-protected-resource", protectedResource),
    HttpRouter.route("GET", `/.well-known/oauth-protected-resource${MCP_PATH}`, protectedResource),
    HttpRouter.route("GET", "/.well-known/oauth-authorization-server", authorizationServer),
    HttpRouter.route("POST", "/register", guarded(register)),
    HttpRouter.route("GET", "/authorize", guarded(authorizePage)),
    HttpRouter.route("POST", "/authorize", guarded(authorizeAnswer)),
    HttpRouter.route("POST", "/token", guarded(token)),
  ];
  const routes = HttpRouter.addAll(all);

  const challengeFor = (invalid: boolean) =>
    [
      `Bearer resource_metadata="${resourceMetadataUrl}"`,
      `scope="${SCOPE}"`,
      ...(invalid
        ? ['error="invalid_token"', 'error_description="The access token is invalid or expired"']
        : []),
    ].join(", ");

  /**
   * Wraps the MCP endpoint: a request without a valid access token for this resource is answered
   * 401 with the challenge that starts a client's discovery (RFC 9728 §5.1).
   */
  const requireToken = HttpRouter.middleware((handler) =>
    Effect.gen(function* () {
      const req = yield* HttpServerRequest.HttpServerRequest;
      const match = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "");
      const grant = match?.[1] ? signer.verify("access", match[1]) : undefined;
      const now = yield* Clock.currentTimeMillis;
      if (!grant || grant.exp * 1000 <= now || grant.aud !== resource)
        return HttpServerResponse.jsonUnsafe(
          { error: "unauthorized", message: ERROR_MESSAGES.unauthorized },
          { status: 401, headers: { "www-authenticate": challengeFor(match !== null) } },
        );
      return yield* handler;
    }),
  ).layer;

  return { routes, requireToken };
};
