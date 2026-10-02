import type { KnipConfig } from "knip";

const knipConfig = {
  // Entries knip can't find from package.json scripts: the PWA (reached through an HTML import:
  // its script and its stylesheet), the service worker (registered by URL), and the Claude Code
  // hook and installer.
  entry: ["src/web/main.tsx", "src/web/index.css", "public/sw.js", "integrations/claude-code/*.ts"],
  // A module's own vocabulary is exported for readers; only what nothing at all uses is dead.
  ignoreExportsUsedInFile: true,
  // .railway is a separate mini-project with its own manifest, read by the Railway CLI.
  // repos/ is vendored upstream source, kept for reference and never imported.
  ignore: [".railway/**", "repos/**"],
  // shadcn components are copied whole from its registry (`bunx shadcn add`): the parts this app
  // doesn't use yet stay, so updating one is a re-add rather than a merge.
  ignoreIssues: { "src/web/components/ui/**": ["exports"] },
} satisfies KnipConfig;

export default knipConfig;
