import type { KnipConfig } from "knip";

const knipConfig = {
  // Entries knip can't find from package.json scripts: the PWA (reached through an HTML import),
  // the service worker (registered by URL), and the Claude Code hook and installer.
  entry: ["src/web/main.tsx", "public/sw.js", "integrations/claude-code/*.ts"],
  // A module's own vocabulary is exported for readers; only what nothing at all uses is dead.
  ignoreExportsUsedInFile: true,
  // .railway is a separate mini-project with its own manifest, read by the Railway CLI.
  ignore: [".railway/**"],
} satisfies KnipConfig;

export default knipConfig;
