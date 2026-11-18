import { defineRailway, github, preserve, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  // SQLite needs a disk that outlives the container; without this every deploy starts empty.
  const data = volume("data", { sizeMB: 1024 });

  // The API and the PWA, and beside them, on a port and a domain of their own, the MCP server over
  // HTTP that claude.ai's connectors (web, desktop, mobile) reach, with its own OAuth, calling the
  // API over loopback like any other client. One process (src/services.ts) rather than two
  // services: Railway counts Bun's runtime once per container, and it is most of what each one
  // holds (docs/deployment.md).
  const web = service("web", {
    // Deploys on every push to main (needs the Railway GitHub app to have access to the repo).
    source: github("Levieber/my-scratchpad", { branch: "main" }),
    // Built from the Dockerfile: the servers compiled into one executable, the PWA inside it, in an
    // image that holds only that. A deploy starts it as it is (~40 ms), and a build that fails
    // fails the deploy instead of starting something else.
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    start: "/app/pad-services",
    // The API's; the MCP server failing to start ends the process, so this fails with it.
    healthcheck: "/api/health",
    healthcheckTimeout: 30,
    volumeMounts: { "/data": data },
    deploy: {
      // SQLite on a single volume, and authorization codes in memory between the approval and
      // the token request: exactly one instance.
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
      // The API takes the PORT Railway gives the service; the MCP server this one, which its
      // domain targets.
      PAD_MCP_PORT: "7778",
      // The MCP server's own https origin, the domain targeting PAD_MCP_PORT: its OAuth issuer, so
      // it can't be the API's (RAILWAY_PUBLIC_DOMAIN). Set in Railway.
      PAD_MCP_URL: preserve(),
      // Signs the connectors' tokens; set once in Railway (changing it signs them all out).
      PAD_OAUTH_SECRET: preserve(),
    },
  });

  return project("scratchpad", { resources: [web] });
});
