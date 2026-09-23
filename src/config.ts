import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const env = process.env;

// Client-side settings written by `pad login`, so the CLI, MCP server and hooks
// can point at a local or a deployed (Railway) server without juggling env vars.
export const clientConfigPath = join(
  env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
  "scratchpad",
  "config.json",
);

function readClientConfig(): { url?: string; token?: string } {
  try {
    return JSON.parse(readFileSync(clientConfigPath, "utf8"));
  } catch {
    return {};
  }
}

const file = readClientConfig();
// Railway (and most PaaS) inject PORT and expect the app on 0.0.0.0.
const port = Number(env.PAD_PORT ?? env.PORT ?? 7777);

export const config = {
  host: env.PAD_HOST ?? (env.PORT ? "0.0.0.0" : "127.0.0.1"),
  port,
  db:
    env.PAD_DB ??
    join(env.XDG_DATA_HOME ?? join(homedir(), ".local/share"), "scratchpad", "pad.db"),
  // Server: optional shared secret; required when listening on a non-loopback address.
  serverToken: env.PAD_TOKEN || undefined,
  // Clients (CLI, MCP): where the API lives and the token to send. Env wins over `pad login`.
  url: (env.PAD_URL ?? file.url ?? `http://127.0.0.1:${port}`).replace(/\/$/, ""),
  token: env.PAD_TOKEN || file.token || undefined,
};
