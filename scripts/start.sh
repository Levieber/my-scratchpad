#!/bin/sh
# Production start: `sh scripts/start.sh server` (the API and the PWA) or `sh scripts/start.sh mcp`
# (the MCP server over HTTP). Builds that one into an executable (scripts/build.ts) and becomes it
# with `exec`, so nothing stays resident beside it: bundled, it holds ~10 MB less than from source,
# and `bun run start` alone would keep ~10 MB of its own for as long as the server runs
# (docs/deployment.md). Built at every start (under a second), so a pulled change is never served
# as the old build; a build that fails runs the server from source, as before.
set -eu
cd "$(dirname "$0")/.."
export NODE_ENV=production

case "${1:-}" in
  server) entry=src/server.ts ;;
  mcp) entry=src/mcp-http.ts ;;
  *)
    echo "usage: scripts/start.sh server|mcp" >&2
    exit 2
    ;;
esac

if bun scripts/build.ts "$1"; then exec "dist/pad-$1"; fi
echo "Could not build dist/pad-$1; running $entry from source instead." >&2
exec bun "$entry"
