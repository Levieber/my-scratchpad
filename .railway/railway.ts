import { defineRailway, github, preserve, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  // SQLite needs a disk that outlives the container; without this every deploy starts empty.
  const data = volume("data", { sizeMB: 1024 });

  const web = service("web", {
    // Deploys on every push to main (needs the Railway GitHub app to have access to the repo).
    source: github("Levieber/my-scratchpad", { branch: "main" }),
    // No Dockerfile, so Railpack builds it and picks Bun up from bun.lock. There is no server
    // build step: the start script builds the server into one executable, the PWA inside it, and
    // becomes it (scripts/start.sh), so nothing here depends on what Railpack's build does. Run
    // directly rather than as `bun run start`, which would stay resident beside it (~10 MB).
    build: { builder: "RAILPACK" },
    start: "sh scripts/start.sh server",
    healthcheck: "/api/health",
    healthcheckTimeout: 30,
    volumeMounts: { "/data": data },
    deploy: {
      // SQLite on a single volume: exactly one instance.
      numReplicas: 1,
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 10,
    },
    env: {
      NODE_ENV: "production",
      PAD_DB: "/data/pad.db",
      // Held in Railway, never in the repo: preserve() leaves whatever is already set alone.
      // The server refuses to start publicly without it.
      PAD_TOKEN: preserve(),
    },
  });

  // claude.ai's connectors (web, desktop, mobile) reach the scratchpad here: the MCP server over
  // HTTP (src/mcp-http.ts), with its own OAuth, calling the API like any other client. A service
  // of its own because clients never run inside the server (docs/architecture.md); it has no
  // volume and keeps nothing on disk.
  const mcp = service("mcp", {
    source: github("Levieber/my-scratchpad", { branch: "main" }),
    build: { builder: "RAILPACK" },
    // As `web` does: built into an executable at start, run without `bun run` above it.
    start: "sh scripts/start.sh mcp",
    healthcheck: "/health",
    healthcheckTimeout: 30,
    deploy: {
      // Authorization codes live in its memory between the approval and the token request, so
      // both must reach the same instance.
      numReplicas: 1,
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 10,
    },
    env: {
      NODE_ENV: "production",
      // The API at its public domain: always reachable, whatever the private network supports.
      PAD_URL: "https://${{web.RAILWAY_PUBLIC_DOMAIN}}",
      // The same secret as the API's, read from it rather than set twice.
      PAD_TOKEN: web.env.PAD_TOKEN,
      PAD_AUTHOR: "claude",
      // Signs the connectors' tokens; set once in Railway (changing it signs them all out).
      PAD_OAUTH_SECRET: preserve(),
    },
  });

  return project("scratchpad", { resources: [web, mcp] });
});
