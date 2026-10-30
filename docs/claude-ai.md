# Claude connectors (claude.ai, desktop, mobile)

Claude Code starts the MCP server as a process on your machine (`src/mcp.ts`, see [claude-code.md](claude-code.md)). Claude on the web, the desktop app and the phone can't: a **custom connector** is a remote MCP server that Anthropic's servers call over HTTPS, signing in with OAuth. `src/mcp-http.ts` is that server. It is a client of the API like the others, so it changes nothing about where the notes live or who may reach them.

```
 claude.ai ──OAuth + /mcp──▶ mcp service (src/mcp-http.ts) ──PAD_TOKEN──▶ web service (the API) ──▶ SQLite
 (web, desktop, mobile)      Streamable HTTP, its own OAuth          HTTP, like pad and the PWA
```

It offers the same tools as Claude Code's server (search, get, create, append, update, history, diff, delete, views, save view) except `scratchpad_hooks`, which describes what the hooks show in a folder of your machine. Writes are attributed to `claude` (`PAD_AUTHOR`), so the PWA and `pad history` tell them apart from Claude Code's.

## Setting it up on Railway

`.railway/railway.ts` declares the `mcp` service next to `web`: same repository, started with `sh scripts/start.sh mcp` (`bun run start:mcp`: the MCP server built into an executable at start, see [deployment.md](deployment.md#running)), no volume. It reads `PAD_TOKEN` from `web` and calls the API at `web`'s public domain. Once the IaC is applied (see [deployment.md](deployment.md#railway)):

```sh
railway variables --service mcp --set "PAD_OAUTH_SECRET=$(openssl rand -hex 32)"   # signs the connectors' tokens
railway domain --service mcp                                                       # its public https address
```

Then, in Claude: **Settings → Connectors → Add custom connector**, name it Scratchpad and give it `https://<the mcp domain>/mcp`. Leave the advanced OAuth fields empty: Claude registers itself. On Team and Enterprise plans an owner adds it for the organization first. **Connect** opens this server's page, which asks for your `PAD_TOKEN`; **Allow** sends you back to Claude, connected. A connector added on the web is there on the desktop and the phone too.

In the connector's settings, each tool can be allowed always or asked about each time. Leave `scratchpad_delete` and `scratchpad_save_view` on asking, as Claude Code's permissions do.

## How it signs in

The MCP authorization spec asks a remote server to be an OAuth 2.1 resource, discoverable from a 401. `src/mcp/oauth/` implements the parts claude.ai uses, and nothing else:

| Endpoint                                      | What it is                                                                                                                   |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `POST /mcp` without a token                   | `401` with `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/mcp"`, which starts discovery |
| `GET /.well-known/oauth-protected-resource`   | RFC 9728: the resource (`<origin>/mcp`) and its authorization server (this origin); also under `…/mcp`                       |
| `GET /.well-known/oauth-authorization-server` | RFC 8414: the endpoints below, PKCE `S256` only, `iss` in the response                                                       |
| `POST /register`                              | RFC 7591 dynamic registration                                                                                                |
| `GET /authorize`, `POST /authorize`           | the approval page and its answer; a code goes back with `state` and `iss` (RFC 9207)                                         |
| `POST /token`                                 | `authorization_code` (with the PKCE verifier) and `refresh_token`                                                            |
| `GET /health`                                 | open: the process is up (it doesn't call the API)                                                                            |

The decisions:

- **You approve with `PAD_TOKEN`.** There are no accounts (one deployment is one scratchpad), so the owner proves it is them with the secret the PWA and `pad login` already ask for. The page compares it in constant time, logs a refused attempt (never what was typed), and is served with a CSP that lets nothing load and the form post only to itself and the client, `frame-ancestors 'none'` and `no-store`.
- **Codes go only to claude.ai and loopback.** Registration accepts `https://claude.ai/api/mcp/auth_callback`, `https://claude.com/api/mcp/auth_callback`, and `http://` on `localhost`, `127.0.0.1` or `[::1]` (Claude Code, the MCP Inspector). A phished approval can't send a code anywhere else. To connect another client, add its callback to `allowedRedirect` in `src/mcp/oauth/routes.ts`.
- **Signed, not stored.** The service has no database (it is a client), and a redeploy must not sign every connector out. A client id carries what the client registered, and access and refresh tokens carry the grant, all signed with HMAC-SHA-256 under a key derived from `PAD_OAUTH_SECRET` (or `PAD_TOKEN` when it is unset). A client's secret is derived from its id. Authorization codes are the exception: they live five minutes and are spent once, so they are kept in memory, which is why the service runs one replica.
- **Bound to this resource.** An access token names `<origin>/mcp` as its audience (RFC 8707) and lasts an hour; the refresh token lasts 30 days and is replaced on every refresh, so a connector in use stays signed in. A request naming another resource is refused (`invalid_target`). `PAD_TOKEN` itself is never accepted on `/mcp`.
- **OAuth's error shape.** These endpoints answer `{ error, error_description }` with OAuth's codes, since OAuth clients read those; `/mcp`'s own 401 and 404s use the API's `{ error, message }`.

**Signing every connector out:** set a new `PAD_OAUTH_SECRET`. Changing `PAD_TOKEN` does it too when `PAD_OAUTH_SECRET` is unset, and it also signs out the PWA and every `pad login`. There is no per-connector revocation: tokens aren't stored, so there is nothing to delete one from.

## Running it locally

```sh
PAD_TOKEN=dev bun run dev                        # the API on :7777
PAD_TOKEN=dev bun src/mcp-http.ts                # http://127.0.0.1:7778/mcp
```

It takes the API's address and token from `pad login`, like the stdio server (`PAD_URL`, `PAD_TOKEN` override them), and refuses to start without a token. claude.ai only connects to https, so a local server is for the MCP Inspector (`bunx @modelcontextprotocol/inspector`, transport "Streamable HTTP", URL above) or `claude mcp add --transport http scratchpad http://127.0.0.1:7778/mcp`.

Claude Code also loads the connectors of the claude.ai account it is signed in with. With both, the scratchpad's tools appear twice (the stdio server's and the connector's); turn one off in `/mcp`.

## The skill and the instructions

The server sends its instructions (what the scratchpad is for, the kinds, tags) on every connection, as the stdio server does. The `scratchpad` skill (`integrations/claude-code/skill/`) can be uploaded in **Settings → Capabilities → Skills** as a zip of that folder, but it talks about `pad` and the hooks too, which a connector doesn't have.

## Logs

The service logs a line per request (method, path, status, duration; never a query string or a header), and `oauth client registered`, `oauth approval granted`, `oauth approval denied` and `oauth approval refused: wrong token`, each with the client's name. On Railway: `railway logs --service mcp`.

## Limits

- One owner: anyone who knows `PAD_TOKEN` can approve a connector, as they could already use the API.
- Dynamic registration only: client ID metadata documents (an `https` client id) aren't supported. Claude's advanced OAuth fields aren't needed; a client registered by hand with `POST /register` would work in them.
- A refresh token that was replaced keeps working until it expires: without storage, reuse can't be detected.
- No CORS: claude.ai calls from its servers. A client running in a browser would need it.
