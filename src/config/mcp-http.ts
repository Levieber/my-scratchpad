// What the MCP server reads when it serves claude.ai over HTTP (`bun src/mcp-http.ts`). Where the
// API lives and the token it is called with come from ClientConfig, as for the stdio server.
import * as Config from "effect/Config";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import { bindHost, optional } from "./env";

// The issuer and the resource are this origin: OAuth compares them as strings, so a path or a
// trailing slash would make every token's audience disagree with the metadata.
const isOrigin = (value: string) => {
  try {
    const url = new URL(value);
    return (
      (["https:", "http:"].includes(url.protocol) &&
        url.pathname === "/" &&
        !url.search &&
        !url.hash) ||
      "must be an origin, like https://mcp.example.com (no path)"
    );
  } catch {
    return "must be an origin, like https://mcp.example.com (no path)";
  }
};

const Origin = Schema.String.pipe(Schema.check(Schema.makeFilter(isOrigin)));

export const DEFAULT_MCP_PORT = 7778;

export const McpHttpConfig = Config.all({
  host: bindHost,
  // PORT first: the platform routes to it. PAD_PORT is the API's port locally, so not this one.
  port: Config.all([
    Config.option(Config.Port("PORT")),
    Config.option(Config.Port("PAD_MCP_PORT")),
  ]).pipe(
    Config.map(([platform, own]) =>
      Option.getOrElse(
        Option.orElse(platform, () => own),
        () => DEFAULT_MCP_PORT,
      ),
    ),
  ),
  // The address claude.ai reaches this server at. Railway names it in RAILWAY_PUBLIC_DOMAIN once
  // the service has a domain.
  publicUrl: Config.option(
    Config.schema(Schema.Union([Schema.Literal(""), Origin]), "PAD_MCP_URL"),
  ).pipe(Config.map(Option.filter((v) => v !== ""))),
  railwayDomain: optional("RAILWAY_PUBLIC_DOMAIN"),
  // Signs the connectors' tokens. Unset, it is derived from PAD_TOKEN; set it to sign every
  // connector out without changing PAD_TOKEN.
  oauthSecret: Config.map(optional("PAD_OAUTH_SECRET"), Option.map(Redacted.make)),
  author: Config.map(
    optional("PAD_AUTHOR"),
    Option.getOrElse(() => "claude"),
  ),
  production: Config.map(optional("NODE_ENV"), (env) => Option.getOrNull(env) === "production"),
}).pipe(
  Config.map(({ publicUrl, railwayDomain, ...config }) => ({
    ...config,
    publicUrl: Option.getOrElse(
      Option.orElse(
        Option.map(publicUrl, (url) => new URL(url).origin),
        () => Option.map(railwayDomain, (domain) => `https://${domain}`),
      ),
      () => `http://127.0.0.1:${config.port}`,
    ),
  })),
);
