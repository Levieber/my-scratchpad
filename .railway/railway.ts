import { defineRailway, github, preserve, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  // SQLite needs a disk that outlives the container; without this every deploy starts empty.
  const data = volume("data", { sizeMB: 1024 });

  const web = service("web", {
    // Deploys on every push to main (needs the Railway GitHub app to have access to the repo).
    source: github("Levieber/my-scratchpad", { branch: "main" }),
    // No Dockerfile, so Railpack builds it and picks Bun up from bun.lock. There is no server
    // build step: `start` runs src/server.ts, and Bun bundles the PWA from its HTML import at startup.
    build: { builder: "RAILPACK" },
    start: "bun run start",
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

  return project("scratchpad", { resources: [web] });
});
