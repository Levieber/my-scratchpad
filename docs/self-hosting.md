# Self-hosting

Scratchpad is one process and one SQLite file. Running it yourself means you own the notes: nothing leaves your machine unless you point a client at somewhere else.

**One deployment is one scratchpad.** There are no accounts: access is a single shared token (`PAD_TOKEN`), and everyone holding it reads and writes the same notes. Run one instance per person or team.

## Choose where it runs

| Where                      | Good for                            | What you do                                                       |
| -------------------------- | ----------------------------------- | ----------------------------------------------------------------- |
| Your machine (loopback)    | one person, one computer            | `bun run start`; no token needed while it listens on `127.0.0.1`  |
| A server you control (VPS) | reaching it from phone and laptop   | Docker or a clone, behind HTTPS with `PAD_TOKEN` set; see below   |
| Railway                    | the same, without managing a server | the repo's IaC in `.railway/`; see [deployment.md](deployment.md) |

A hosted version run by the maintainer is not available yet. If it appears, it will be the same software behind the same API, so the clients only need `pad login <url> <token>` to use either.

## On your machine

```sh
git clone <your fork or this repo> && cd my-scratchpad
bun install
bun run start        # http://127.0.0.1:7777; the database is ~/.local/share/scratchpad/pad.db
```

## With Docker

The `Dockerfile` builds an image holding the server and the MCP server over HTTP, each compiled into one executable (about 50 MB of memory once running). It listens on every interface, so it needs a token, and keeps the database on `/data`:

```sh
docker build -t scratchpad .
docker run -d -p 7777:7777 -v scratchpad:/data -e PAD_TOKEN=<token> scratchpad
```

Put HTTPS in front of it as below. The MCP server for Claude's connectors is the same image: `docker run -p 7778:7778 -e PAD_URL=<the API> -e PAD_TOKEN=<token> scratchpad /app/pad-mcp`.

## On a server

1. Install [Bun](https://bun.sh), clone the repo and run `bun install`.
2. Create a token and keep it: `openssl rand -hex 32`.
3. Start it, binding a non-loopback address. The server refuses to do that without a token:

   ```sh
   PAD_HOST=0.0.0.0 PAD_TOKEN=<token> PAD_DB=/var/lib/scratchpad/pad.db bun run start
   ```

4. Put a reverse proxy with HTTPS (Caddy, nginx, Cloudflare Tunnel) in front. The token travels in a header, so never expose the plain HTTP port.
5. Keep it running with your service manager. A systemd unit is enough: `ExecStart=/bin/sh <the clone>/scripts/start.sh server`, `WorkingDirectory=<the clone>`, a `PATH` that finds `bun`, and the variables above in `Environment=` or an `EnvironmentFile=`. The script builds the server into one executable and becomes it; `bun run start` does the same but stays resident above it, ~10 MB for nothing ([deployment.md](deployment.md#running)).

Back up by copying `pad.db` (with its `-wal` file, or after stopping the server). Schema changes ship as migrations that run on startup, so updating is `git pull && bun install` and a restart.

## On a small machine

One process: about 67 MB at start and 96 MB with a thousand notes served to a browser (see [Memory and egress](deployment.md#memory-and-egress)). Starting builds the PWA for about half a second in a separate process, which needs the clone to be writable at `dist/web`; if it isn't, the server logs a warning and works, using ~80 MB more. Polling tabs cost almost no traffic: unchanged collections answer `304`.

## On Railway

The repo declares its Railway service in `.railway/railway.ts`. Before applying it, point `github("…")` at your own fork; it names the repository to deploy from. [deployment.md](deployment.md) has the steps.

## Connect your clients

```sh
pad login https://pad.example.com <token>    # CLI, MCP server and Claude Code hooks use it from now on
bun run setup:claude                         # optional: wire up Claude Code (see claude-code.md)
```

Claude on the web, desktop and phone connects through a custom connector: `bun run start:mcp` beside the server, behind HTTPS (see [claude-ai.md](claude-ai.md)).

Agents attribute their writes with `X-Pad-Author: <name>`; the PWA asks for the token the first time it gets a 401.

## Back up, or move to another server

```sh
pad export backup.json         # every note with its history, saved searches, pins and hook choices
pad import backup.json         # into whichever server `pad login` points at; notes that exist are left as they are
```

Settings → Data in the app does the same. The file is the same whichever way a server is run, so it is also how you move between a self-hosted server and a hosted one, in either direction. [export-format.md](export-format.md) specifies it.
