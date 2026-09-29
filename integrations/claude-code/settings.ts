// The part of ~/.claude/settings.json the installer owns: our hooks and permissions, added and
// removed without touching anything else there. Pure, so it can be tested without a real HOME.
import { join } from "node:path";

type Hook = { type: string; command: string; timeout?: number };
export type Settings = {
  hooks?: Record<string, { matcher?: string; hooks: Hook[] }[]>;
  permissions?: { allow?: string[] };
  [k: string]: unknown;
};

/** Every hook the installer adds, by event. */
export const HOOKS = {
  SessionStart: { script: "session-start.ts", timeout: 5 },
  PostToolUse: {
    script: "record-edit.ts",
    timeout: 5,
    matcher: "Edit|Write|MultiEdit|NotebookEdit",
  },
  Stop: { script: "review-hook.ts", timeout: 10 },
} as const;

export const ALLOW = [
  ...["search", "get", "create", "append", "update", "daily", "history", "diff"].map(
    (t) => `mcp__scratchpad__scratchpad_${t}`,
  ),
  ...["pad ls:*", "pad show:*", "pad history:*", "pad diff:*", "pad tags", "pad status"].map(
    (c) => `Bash(${c})`,
  ),
];

export const hookScript = (repo: string, script: string) =>
  join(repo, "integrations/claude-code", script);

// Matched by script path, so entries from an older install (another bun path) are found too.
const isOurs = (h: Hook) =>
  Object.values(HOOKS).some(({ script }) =>
    h.command.includes(`integrations/claude-code/${script}`),
  );

/** The settings with everything we ever added removed; the user's own entries stay as they were. */
export function withoutOurs(s: Settings): Settings {
  const next: Settings = { ...s };
  if (s.hooks) {
    const hooks: NonNullable<Settings["hooks"]> = {};
    for (const [event, groups] of Object.entries(s.hooks)) {
      const kept = groups
        .map((g) => ({ ...g, hooks: g.hooks.filter((h) => !isOurs(h)) }))
        .filter((g) => g.hooks.length);
      if (kept.length) hooks[event] = kept;
    }
    next.hooks = hooks;
  }
  if (s.permissions?.allow)
    next.permissions = {
      ...s.permissions,
      allow: s.permissions.allow.filter((p) => !ALLOW.includes(p)),
    };
  return next;
}

/** The settings with our current hooks and permissions, replacing any earlier ones. */
export function withOurs(s: Settings, bun: string, repo: string): Settings {
  const next = withoutOurs(s);
  const hooks = { ...next.hooks };
  for (const [event, hook] of Object.entries(HOOKS)) {
    hooks[event] = [
      ...(hooks[event] ?? []),
      {
        ...("matcher" in hook && { matcher: hook.matcher }),
        hooks: [
          {
            type: "command",
            command: `${bun} ${hookScript(repo, hook.script)}`,
            timeout: hook.timeout,
          },
        ],
      },
    ];
  }
  return {
    ...next,
    hooks,
    permissions: { ...next.permissions, allow: [...(next.permissions?.allow ?? []), ...ALLOW] },
  };
}
