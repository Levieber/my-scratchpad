import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";

import {
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
  refreshAuthorization,
  type OAuthClientProvider,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { ROOT, type TestServer, testServer } from "@test/support";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Redacted from "effect/Redacted";

import { mcpHttpLayer } from "@/mcp/http";
import { fingerprint, makeSigner, s256 } from "@/mcp/oauth/tokens";

// The MCP server as claude.ai reaches it: over HTTP, behind OAuth, in front of a real API. The
// reference SDK client plays claude.ai, so discovery, registration, PKCE and refresh are checked
// against how a real client reads them.
const TOKEN = "owner-token-for-tests";
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";

// The issuer must be known before the server listens, so the port is chosen first.
const freePort = () => {
  const probe = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = probe.port as number;
  void probe.stop(true);
  return port;
};

type Log = { level: string; message: unknown; annotations: Record<string, unknown> };

let api: TestServer;
let base: string;
let logs: Log[];
let stop: () => Promise<void>;

beforeAll(async () => {
  api = await testServer({ token: TOKEN });
  const port = freePort();
  base = `http://127.0.0.1:${port}`;
  logs = [];
  const sink = Logger.map(Logger.formatStructured, (entry) => void logs.push(entry));
  const runtime = ManagedRuntime.make(
    mcpHttpLayer({
      api: { url: api.url.origin, token: Redacted.make(TOKEN) },
      publicUrl: base,
      author: "claude",
      port,
    }).pipe(Layer.provide(Logger.layer([sink]))),
  );
  // Building the runtime starts the server.
  await runtime.runPromise(Effect.void);
  stop = () => runtime.dispose();
});

afterAll(async () => {
  await stop();
  await api.stop();
});

const verifier = "v".repeat(43) + "erifier-for-the-tests";
const mcpHeaders = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};
const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "0" },
  },
};
const postMcp = (headers: Record<string, string> = {}) =>
  fetch(`${base}/mcp`, {
    method: "POST",
    headers: { ...mcpHeaders, ...headers },
    body: JSON.stringify(initialize),
  });

const register = async (body: Record<string, unknown>) => {
  const res = await fetch(`${base}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, string> };
};

const publicClient = async (redirect = CALLBACK) =>
  (
    await register({
      client_name: "Claude",
      redirect_uris: [redirect],
      token_endpoint_auth_method: "none",
    })
  ).body.client_id as string;

const authorizeQuery = (clientId: string, extra: Record<string, string> = {}) =>
  new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: CALLBACK,
    code_challenge: s256(verifier),
    code_challenge_method: "S256",
    state: "st4te",
    resource: `${base}/mcp`,
    ...extra,
  });

/** POSTs the consent form as the owner would, without following the redirect. */
const answer = (query: URLSearchParams, decision: string, token = TOKEN) =>
  fetch(`${base}/authorize`, {
    method: "POST",
    redirect: "manual",
    body: new URLSearchParams([...query, ["decision", decision], ["token", token]]),
  });

const codeFor = async (clientId: string) => {
  const res = await answer(authorizeQuery(clientId), "allow");
  return new URL(res.headers.get("location") ?? "").searchParams.get("code") ?? "";
};

const tokenRequest = (params: Record<string, string>, headers: Record<string, string> = {}) =>
  fetch(`${base}/token`, { method: "POST", headers, body: new URLSearchParams(params) });

const tokensFor = async (clientId: string) => {
  const res = await tokenRequest({
    grant_type: "authorization_code",
    code: await codeFor(clientId),
    client_id: clientId,
    code_verifier: verifier,
    redirect_uri: CALLBACK,
  });
  return (await res.json()) as OAuthTokens;
};

describe("discovery", () => {
  test("/mcp without a token answers 401 with the challenge that leads to the metadata", async () => {
    const res = await postMcp();
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(
      `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp", scope="scratchpad"`,
    );
    expect(await res.json()).toMatchObject({ error: "unauthorized" });
    // Every method on /mcp, not just the one that serves JSON-RPC.
    for (const method of ["GET", "DELETE"])
      expect((await fetch(`${base}/mcp`, { method })).status).toBe(401);
  });

  test("the SDK finds the resource and its authorization server", async () => {
    const resource = await discoverOAuthProtectedResourceMetadata(`${base}/mcp`);
    expect(resource).toMatchObject({ resource: `${base}/mcp`, authorization_servers: [base] });
    const server = await discoverAuthorizationServerMetadata(base);
    expect(server).toMatchObject({
      issuer: base,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      registration_endpoint: `${base}/register`,
      code_challenge_methods_supported: ["S256"],
    });
  });

  test("health and the root page need no token; anything else is the API's 404", async () => {
    expect(await (await fetch(`${base}/health`)).json()).toEqual({ ok: true });
    expect(await (await fetch(base)).text()).toContain(`${base}/mcp`);
    const res = await fetch(`${base}/nowhere`);
    expect([res.status, ((await res.json()) as { error: string }).error]).toEqual([
      404,
      "notFound",
    ]);
  });
});

describe("a connector, end to end", () => {
  // What claude.ai does: register, send the person to approve, swap the code, call the tools.
  class Provider implements OAuthClientProvider {
    client: OAuthClientInformationMixed | undefined;
    saved: OAuthTokens | undefined;
    verifierValue = "";
    authorizationUrl: URL | undefined;
    readonly redirectUrl = CALLBACK;
    readonly clientMetadata = {
      client_name: "Claude",
      redirect_uris: [CALLBACK],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
    };
    clientInformation = () => this.client;
    saveClientInformation = (info: OAuthClientInformationMixed) => void (this.client = info);
    tokens = () => this.saved;
    saveTokens = (tokens: OAuthTokens) => void (this.saved = tokens);
    redirectToAuthorization = (url: URL) => void (this.authorizationUrl = url);
    saveCodeVerifier = (v: string) => void (this.verifierValue = v);
    codeVerifier = () => this.verifierValue;
  }

  const provider = new Provider();
  let mcp: McpClient;

  beforeAll(async () => {
    const connect = async () => {
      mcp = new McpClient({ name: "claude.ai", version: "0" });
      await mcp.connect(
        new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { authProvider: provider }),
      );
    };
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      authProvider: provider,
    });
    // The first connection fails: nobody has approved yet.
    const refused = await new McpClient({ name: "claude.ai", version: "0" })
      .connect(transport)
      .then(
        () => false,
        () => true,
      );
    expect(refused).toBe(true);
    const asked = provider.authorizationUrl;
    if (!asked) throw new Error("the SDK never asked for authorization");
    expect(asked.origin + asked.pathname).toBe(`${base}/authorize`);
    // The person approves on the page.
    const page = await fetch(asked);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("<strong>Claude</strong>");
    const approved = await answer(asked.searchParams, "allow");
    expect(approved.status).toBe(303);
    const back = new URL(approved.headers.get("location") ?? "");
    expect(back.origin + back.pathname).toBe(CALLBACK);
    expect(back.searchParams.get("state")).toBe(asked.searchParams.get("state"));
    expect(back.searchParams.get("iss")).toBe(base);
    await transport.finishAuth(back.searchParams.get("code") ?? "");
    await connect();
  });

  afterAll(() => mcp.close());

  test("lists the note tools, without the hooks, which only mean something in Claude Code", async () => {
    const { tools } = await mcp.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("scratchpad_search");
    expect(names).toContain("scratchpad_save_view");
    expect(names).not.toContain("scratchpad_hooks");
    expect(mcp.getInstructions()).toContain('attributed as "claude"');
  });

  test("writes reach the API with PAD_TOKEN, attributed to claude", async () => {
    const result = (await mcp.callTool({
      name: "scratchpad_create",
      arguments: { body: "# From a connector\nhello", tags: ["connector"] },
    })) as { content: { text: string }[] };
    const created = JSON.parse(result.content[0]?.text ?? "{}") as { id: string; author: string };
    expect(created.author).toBe("claude");
    const res = await fetch(new URL(`/api/notes/${created.id}`, api.url), {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(((await res.json()) as { title: string }).title).toBe("From a connector");
  });

  test("a refresh token gets a new pair, and the new access token works", async () => {
    const metadata = await discoverAuthorizationServerMetadata(base);
    const refreshed = await refreshAuthorization(base, {
      metadata,
      clientInformation: provider.client as OAuthClientInformationMixed,
      refreshToken: provider.saved?.refresh_token ?? "",
      resource: new URL(`${base}/mcp`),
    });
    expect(refreshed.refresh_token).not.toBe(provider.saved?.refresh_token);
    expect(refreshed.expires_in).toBe(3600);
    const res = await postMcp({ authorization: `Bearer ${refreshed.access_token}` });
    expect(res.status).toBe(200);
  });

  test("nothing logged carries a token", () => {
    const logged = JSON.stringify(logs);
    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain(provider.saved?.access_token ?? "<none>");
    expect(logs.map((l) => l.message)).toContain("oauth approval granted");
  });
});

describe("registration", () => {
  test("only claude.ai's callbacks and loopback addresses can receive a code", async () => {
    for (const uri of [
      CALLBACK,
      "https://claude.com/api/mcp/auth_callback",
      "http://localhost:33418/callback",
      "http://127.0.0.1:6274/oauth/callback",
    ])
      expect((await register({ redirect_uris: [uri] })).status).toBe(201);
    for (const uri of [
      "https://evil.example/callback",
      "https://claude.ai.evil.example/api/mcp/auth_callback",
      "http://claude.ai/api/mcp/auth_callback",
      "not a url",
    ]) {
      const refused = await register({ redirect_uris: [CALLBACK, uri] });
      expect([refused.status, refused.body.error]).toEqual([400, "invalid_redirect_uri"]);
    }
    expect((await register({ client_name: "no redirects" })).body.error).toBe(
      "invalid_redirect_uri",
    );
    const many = Array.from({ length: 11 }, (_, i) => `http://localhost:${4000 + i}/cb`);
    expect((await register({ redirect_uris: many })).body.error).toBe("invalid_redirect_uri");
  });

  test("a confidential client gets a secret, a public one doesn't", async () => {
    const confidential = await register({ redirect_uris: [CALLBACK] });
    expect(confidential.body).toMatchObject({ token_endpoint_auth_method: "client_secret_basic" });
    expect(confidential.body.client_secret).toBeString();
    const pub = await register({ redirect_uris: [CALLBACK], token_endpoint_auth_method: "none" });
    expect(pub.body.client_secret).toBeUndefined();
    const odd = await register({
      redirect_uris: [CALLBACK],
      token_endpoint_auth_method: "private_key_jwt",
    });
    expect([odd.status, odd.body.error]).toEqual([400, "invalid_client_metadata"]);
  });

  test("a body that isn't a JSON object is refused", async () => {
    const res = await fetch(`${base}/register`, { method: "POST", body: "nope" });
    expect([res.status, ((await res.json()) as { error: string }).error]).toEqual([
      400,
      "invalid_client_metadata",
    ]);
  });
});

describe("the consent page", () => {
  test("names the client escaped, and its CSP lets the form go only here and to the client", async () => {
    const { body } = await register({
      client_name: '<script>alert("x")</script>',
      redirect_uris: [CALLBACK],
      token_endpoint_auth_method: "none",
    });
    const res = await fetch(`${base}/authorize?${authorizeQuery(body.client_id ?? "")}`);
    const html = await res.text();
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(res.headers.get("content-security-policy")).toContain(
      "form-action 'self' https://claude.ai",
    );
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  test("an unknown client or an unregistered redirect gets a page, never a redirect", async () => {
    const forged = await fetch(`${base}/authorize?${authorizeQuery("pad_client.e30.forged")}`, {
      redirect: "manual",
    });
    expect([forged.status, forged.headers.get("location")]).toEqual([400, null]);
    const clientId = await publicClient();
    const elsewhere = await fetch(
      `${base}/authorize?${authorizeQuery(clientId, { redirect_uri: "https://claude.com/api/mcp/auth_callback" })}`,
      { redirect: "manual" },
    );
    expect([elsewhere.status, elsewhere.headers.get("location")]).toEqual([400, null]);
  });

  test("a request without PKCE S256 goes back to the client as invalid_request", async () => {
    const clientId = await publicClient();
    const res = await fetch(
      `${base}/authorize?${authorizeQuery(clientId, { code_challenge_method: "plain" })}`,
      { redirect: "manual" },
    );
    const back = new URL(res.headers.get("location") ?? "");
    expect([back.searchParams.get("error"), back.searchParams.get("state")]).toEqual([
      "invalid_request",
      "st4te",
    ]);
  });

  test("another resource goes back as invalid_target", async () => {
    const clientId = await publicClient();
    const res = await fetch(
      `${base}/authorize?${authorizeQuery(clientId, { resource: "https://other.example/mcp" })}`,
      { redirect: "manual" },
    );
    expect(new URL(res.headers.get("location") ?? "").searchParams.get("error")).toBe(
      "invalid_target",
    );
  });

  test("a wrong token shows the page again with no code; denying sends access_denied", async () => {
    const clientId = await publicClient();
    const wrong = await answer(authorizeQuery(clientId), "allow", "guess");
    expect([wrong.status, wrong.headers.get("location")]).toEqual([401, null]);
    expect(await wrong.text()).toContain("isn&#39;t this server&#39;s PAD_TOKEN");
    const denied = await answer(authorizeQuery(clientId), "deny");
    const back = new URL(denied.headers.get("location") ?? "");
    expect(back.searchParams.get("error")).toBe("access_denied");
    expect(back.searchParams.has("code")).toBe(false);
  });
});

describe("the token endpoint", () => {
  test("a code is spent on first use", async () => {
    const clientId = await publicClient();
    const code = await codeFor(clientId);
    const exchange = () =>
      tokenRequest({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        code_verifier: verifier,
      });
    expect((await exchange()).status).toBe(200);
    const again = await exchange();
    expect([again.status, ((await again.json()) as { error: string }).error]).toEqual([
      400,
      "invalid_grant",
    ]);
  });

  test("the wrong verifier, another client or another redirect gets invalid_grant", async () => {
    const clientId = await publicClient();
    const other = await publicClient();
    const attempts: Record<string, string>[] = [
      { client_id: clientId, code_verifier: "w".repeat(43) },
      { client_id: other, code_verifier: verifier },
      { client_id: clientId, code_verifier: verifier, redirect_uri: "http://localhost:1/cb" },
    ];
    for (const params of attempts) {
      const res = await tokenRequest({
        grant_type: "authorization_code",
        code: await codeFor(clientId),
        ...params,
      });
      expect([res.status, ((await res.json()) as { error: string }).error]).toEqual([
        400,
        "invalid_grant",
      ]);
    }
  });

  test("a confidential client must prove its secret, by Basic or in the body", async () => {
    const { body } = await register({ redirect_uris: [CALLBACK] });
    const id = body.client_id ?? "";
    const secret = body.client_secret ?? "";
    const basic = (s: string) => ({
      authorization: `Basic ${btoa(`${encodeURIComponent(id)}:${encodeURIComponent(s)}`)}`,
    });
    const exchange = async (params: Record<string, string>, headers = {}) =>
      tokenRequest(
        {
          grant_type: "authorization_code",
          code: await codeFor(id),
          code_verifier: verifier,
          ...params,
        },
        headers,
      );
    const wrong = await exchange({}, basic("wrong"));
    expect([wrong.status, wrong.headers.get("www-authenticate")]).toEqual([
      401,
      'Basic realm="scratchpad"',
    ]);
    expect((await exchange({ client_id: id })).status).toBe(401);
    expect((await exchange({}, basic(secret))).status).toBe(200);
    expect((await exchange({ client_id: id, client_secret: secret })).status).toBe(200);
  });

  test("two registrations alike are two clients", async () => {
    expect(await publicClient()).not.toBe(await publicClient());
  });

  test("a refresh token is bound to its client; an unknown grant is refused", async () => {
    const clientId = await publicClient();
    const tokens = await tokensFor(clientId);
    const other = await publicClient();
    const stolen = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token ?? "",
      client_id: other,
    });
    expect(((await stolen.json()) as { error: string }).error).toBe("invalid_grant");
    const odd = await tokenRequest({ grant_type: "client_credentials", client_id: clientId });
    expect(((await odd.json()) as { error: string }).error).toBe("unsupported_grant_type");
  });

  test("answers are never cached", async () => {
    const res = await tokenRequest({ grant_type: "client_credentials", client_id: "x" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("the MCP endpoint", () => {
  const signer = makeSigner(TOKEN);
  const grant = (over: Partial<{ aud: string; exp: number }> = {}) => ({
    cid: fingerprint("someone"),
    aud: `${base}/mcp`,
    scope: "scratchpad",
    exp: Math.floor(Date.now() / 1000) + 60,
    jti: "j",
    ...over,
  });

  test("refuses a token that is forged, expired, for another resource or a refresh token", async () => {
    const valid = signer.sign("access", grant());
    for (const token of [
      `${valid.slice(0, -2)}xx`,
      signer.sign("access", grant({ exp: Math.floor(Date.now() / 1000) - 1 })),
      signer.sign("access", grant({ aud: "https://other.example/mcp" })),
      signer.sign("refresh", grant()),
      makeSigner("another secret").sign("access", grant()),
      TOKEN,
    ]) {
      const res = await postMcp({ authorization: `Bearer ${token}` });
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toContain('error="invalid_token"');
    }
    expect((await postMcp({ authorization: `Bearer ${valid}` })).status).toBe(200);
  });

  test("a browser page from another site is refused even with a token", async () => {
    const token = signer.sign("access", grant());
    const res = await postMcp({ authorization: `Bearer ${token}`, origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });
});

describe("bun src/mcp-http.ts", () => {
  test("refuses to start without PAD_TOKEN", async () => {
    const proc = Bun.spawn(["bun", join(ROOT, "src", "mcp-http.ts")], {
      env: { ...process.env, PAD_TOKEN: "", PAD_URL: "", XDG_CONFIG_HOME: "/nonexistent" },
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(await proc.exited).toBe(1);
    expect(await new Response(proc.stdout).text()).toContain("needs PAD_TOKEN");
  });
});
