import { defineRailway, github, preserve, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const data = volume("data", { sizeMB: 1024 });

  const web = service("web", {
    source: github("Levieber/my-scratchpad", { branch: "main" }),
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    start: "/app/pad-services",
    healthcheck: "/api/health",
    healthcheckTimeout: 30,
    volumeMounts: { "/data": data },
    deploy: {
      numReplicas: 1,
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 10,
    },
    env: {
      NODE_ENV: "production",
      PAD_DB: "/data/pad.db",
      PAD_TOKEN: preserve(),
      PAD_MCP_PORT: "7778",
      PAD_MCP_URL: preserve(),
      PAD_OAUTH_SECRET: preserve(),
    },
  });

  return project("scratchpad", { resources: [web] });
});
