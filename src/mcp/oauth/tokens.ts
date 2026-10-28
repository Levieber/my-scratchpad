// What the authorization server hands out, signed instead of stored: the MCP server has no
// database of its own (it is a client of the API), and a redeploy must not sign every connector
// out. A client id carries what the client registered; an access or refresh token carries the
// grant. Changing the secret they are signed with revokes them all at once.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SCOPE = "scratchpad";
export const ACCESS_TTL_S = 60 * 60;
// Refreshing rotates the refresh token, so a connector in use never reaches this.
export const REFRESH_TTL_S = 30 * 24 * 60 * 60;

export const AUTH_METHODS = ["none", "client_secret_post", "client_secret_basic"] as const;
export type AuthMethod = (typeof AUTH_METHODS)[number];

/** What a client registered (RFC 7591), as its client id carries it. */
export type ClientInfo = {
  name?: string;
  redirect_uris: string[];
  auth: AuthMethod;
  iat: number;
  /** Two registrations alike are still two clients, each with its own id and secret. */
  jti: string;
};

/** What an access or refresh token grants: the scratchpad, to one client, for one resource. */
export type Grant = {
  /** The client's fingerprint (`fingerprint(client_id)`): a client id is too long to embed. */
  cid: string;
  aud: string;
  scope: string;
  /** Epoch seconds. */
  exp: number;
  jti: string;
};

type Payloads = { client: ClientInfo; access: Grant; refresh: Grant };
type Kind = keyof Payloads;

// Readable prefixes, so a token pasted somewhere says what it is (and secret scanners can match).
const PREFIX: Record<Kind, string> = { client: "pad_client", access: "pad_at", refresh: "pad_rt" };

const base64url = (data: Buffer | string) => Buffer.from(data).toString("base64url");

export const randomToken = (bytes = 32) => base64url(randomBytes(bytes));

/** Compares secrets in constant time, whatever their lengths. */
export const sameSecret = (a: string, b: string) =>
  timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());

/** The PKCE S256 challenge of a verifier (RFC 7636). */
export const s256 = (verifier: string) => base64url(createHash("sha256").update(verifier).digest());

export const fingerprint = (clientId: string) =>
  base64url(createHash("sha256").update(clientId).digest().subarray(0, 16));

export const makeSigner = (secret: string) => {
  // Its own key, so a signature never doubles as anything PAD_TOKEN is used for.
  const key = createHmac("sha256", secret).update("scratchpad/mcp-oauth/v1").digest();
  const mac = (data: string) => base64url(createHmac("sha256", key).update(data).digest());

  const sign = <K extends Kind>(kind: K, payload: Payloads[K]) => {
    const body = `${PREFIX[kind]}.${base64url(JSON.stringify(payload))}`;
    return `${body}.${mac(body)}`;
  };

  /** The payload, if `token` is a `kind` this signer made; expiry is the caller's to check. */
  const verify = <K extends Kind>(kind: K, token: string): Payloads[K] | undefined => {
    const [prefix, payload, signature, ...rest] = token.split(".");
    if (prefix !== PREFIX[kind] || !payload || !signature || rest.length > 0) return undefined;
    if (!sameSecret(signature, mac(`${prefix}.${payload}`))) return undefined;
    try {
      const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      return parsed && typeof parsed === "object" ? (parsed as Payloads[K]) : undefined;
    } catch {
      return undefined;
    }
  };

  // Derived rather than stored: only this signer can compute it, so it proves the client is the
  // one that registered.
  const clientSecret = (clientId: string) => mac(`client-secret:${clientId}`);

  return { sign, verify, clientSecret };
};
