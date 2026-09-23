#!/usr/bin/env bun
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

// Wire the scratchpad into Claude Code (user scope). Idempotent; safe to re-run.
//   bun run setup:claude                 install everything
//   bun run setup:claude --no-service    skip the local systemd server (e.g. Railway-only)
//   bun run setup:claude --uninstall     remove everything this script added
import { $ } from "bun";

const REPO = resolve(import.meta.dir, "../..");
// Prefer the PATH entry (e.g. a mise shim) over execPath, which pins a version directory that upgrades remove.
const BUN = Bun.which("bun") ?? process.execPath;
const HOME = homedir();
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR ?? join(HOME, ".claude");
const SETTINGS = join(CLAUDE_DIR, "settings.json");
const CLAUDE_MD = join(CLAUDE_DIR, "CLAUDE.md");
const SKILL_LINK = join(CLAUDE_DIR, "skills", "scratchpad");
const PAD_LINK = join(HOME, ".local", "bin", "pad");
const UNIT = join(
  process.env.XDG_CONFIG_HOME ?? join(HOME, ".config"),
  "systemd",
  "user",
  "scratchpad.service",
);
const HOOK_SCRIPT = join(REPO, "integrations/claude-code/session-start.ts");

const args = new Set(process.argv.slice(2));
const withService = !args.has("--no-service");

const step = (msg: string) => console.log(`\x1b[1m→ ${msg}\x1b[0m`);

const link = (target: string, path: string) => {
  mkdirSync(dirname(path), { recursive: true });
  rmSync(path, { force: true });
  symlinkSync(target, path);
};

const ALLOW = [
  ...["search", "get", "create", "append", "update"].map((t) => `mcp__scratchpad__scratchpad_${t}`),
  ...["pad ls:*", "pad show:*", "pad tags", "pad status"].map((c) => `Bash(${c})`),
];

type Hook = { type: string; command: string; timeout?: number };
type Settings = {
  hooks?: Record<string, { matcher?: string; hooks: Hook[] }[]>;
  permissions?: { allow?: string[] };
  [k: string]: unknown;
};

// Load settings with our previous entries stripped, let `fn` add new ones, write back (with a backup).
function editSettings(fn: (s: Settings) => void) {
  const exists = existsSync(SETTINGS);
  const s: Settings = exists ? JSON.parse(readFileSync(SETTINGS, "utf8")) : {};
  if (exists) copyFileSync(SETTINGS, `${SETTINGS}.bak-scratchpad`);

  if (s.hooks?.SessionStart) {
    const groups = s.hooks.SessionStart.map((g) => ({
      ...g,
      hooks: g.hooks.filter(
        (h) => !h.command.includes("integrations/claude-code/session-start.ts"),
      ),
    })).filter((g) => g.hooks.length);
    if (groups.length) s.hooks.SessionStart = groups;
    else delete s.hooks.SessionStart;
  }
  if (s.permissions?.allow)
    s.permissions.allow = s.permissions.allow.filter((p) => !ALLOW.includes(p));

  fn(s);
  mkdirSync(CLAUDE_DIR, { recursive: true });
  writeFileSync(SETTINGS, JSON.stringify(s, null, 2) + "\n");
}

// Replace (or remove, when block is null) the managed block in CLAUDE.md, leaving the rest untouched.
function editClaudeMd(block: string | null) {
  const cur = existsSync(CLAUDE_MD) ? readFileSync(CLAUDE_MD, "utf8") : "";
  const rest = cur
    .replace(/<!-- scratchpad:start -->[\s\S]*?<!-- scratchpad:end -->\n?/, "")
    .trimEnd();
  const parts = [rest, block?.trim()].filter(Boolean);
  writeFileSync(CLAUDE_MD, parts.length ? parts.join("\n\n") + "\n" : "");
}

async function install() {
  step(`pad CLI -> ${PAD_LINK}`);
  for (const f of ["src/cli.ts", "src/mcp.ts", "integrations/claude-code/session-start.ts"])
    chmodSync(join(REPO, f), 0o755);
  link(join(REPO, "src/cli.ts"), PAD_LINK);

  if (withService) {
    step(`local server as systemd user service (${UNIT})`);
    mkdirSync(dirname(UNIT), { recursive: true });
    writeFileSync(
      UNIT,
      `[Unit]
Description=Scratchpad API + PWA (local)
After=network.target

[Service]
WorkingDirectory=${REPO}
Environment=NODE_ENV=production
ExecStart=${BUN} src/server.ts
Restart=on-failure

[Install]
WantedBy=default.target
`,
    );
    await $`systemctl --user daemon-reload`;
    await $`systemctl --user enable scratchpad.service`.quiet();
    await $`systemctl --user restart scratchpad.service`;
  }

  step("MCP server 'scratchpad' (user scope)");
  await $`claude mcp remove --scope user scratchpad`.quiet().nothrow();
  await $`claude mcp add --scope user scratchpad -- ${BUN} ${join(REPO, "src/mcp.ts")}`;

  step(`skill -> ${SKILL_LINK}`);
  link(join(REPO, "integrations/claude-code/skill"), SKILL_LINK);

  step(`SessionStart hook + permissions -> ${SETTINGS} (backup: settings.json.bak-scratchpad)`);
  editSettings((s) => {
    s.hooks ??= {};
    (s.hooks.SessionStart ??= []).push({
      hooks: [{ type: "command", command: `${BUN} ${HOOK_SCRIPT}`, timeout: 5 }],
    });
    s.permissions ??= {};
    s.permissions.allow = [...(s.permissions.allow ?? []), ...ALLOW];
  });

  step(`instructions block -> ${CLAUDE_MD}`);
  editClaudeMd(readFileSync(join(import.meta.dir, "CLAUDE.snippet.md"), "utf8"));

  step("check");
  if (withService) await Bun.sleep(800);
  await $`${BUN} ${join(REPO, "src/cli.ts")} status`.nothrow();
  console.log("\nDone. Restart Claude Code sessions to pick up the MCP server, skill and hook.");
}

async function uninstall() {
  step("removing scratchpad integration");
  if (existsSync(UNIT)) {
    await $`systemctl --user disable --now scratchpad.service`.quiet().nothrow();
    rmSync(UNIT);
    await $`systemctl --user daemon-reload`.nothrow();
  }
  await $`claude mcp remove --scope user scratchpad`.quiet().nothrow();
  rmSync(SKILL_LINK, { force: true });
  rmSync(PAD_LINK, { force: true });
  if (existsSync(SETTINGS)) editSettings(() => {});
  if (existsSync(CLAUDE_MD)) editClaudeMd(null);
  console.log("Removed. Your notes (the database) were kept.");
}

await (args.has("--uninstall") ? uninstall() : install());
