// The part of ~/.claude/settings.json the installer owns: our hooks and permissions, added and
// removed without touching anything else there. Pure, so it can be tested without a real HOME.
import type { HookName } from "./hooks";

type Hook = { type: string; command: string; timeout?: number };
export type Settings = {
  hooks?: Record<string, { matcher?: string; hooks: Hook[] }[]>;
  permissions?: { allow?: string[] };
  [k: string]: unknown;
};

/** Every hook the installer adds, by event: `pad hook <name>`. */
export const HOOKS = {
  SessionStart: { name: "session-start", timeout: 5 },
  PostToolUse: {
    name: "record-edit",
    timeout: 5,
    matcher: "Edit|Write|MultiEdit|NotebookEdit",
  },
  Stop: { name: "review", timeout: 10 },
} as const satisfies Record<string, { name: HookName; timeout: number; matcher?: string }>;

export const ALLOW = [
  ...["search", "get", "create", "append", "update", "history", "diff", "hooks"].map(
    (t) => `mcp__scratchpad__scratchpad_${t}`,
  ),
  ...[
    "pad ls:*",
    "pad show:*",
    "pad history:*",
    "pad diff:*",
    "pad tags",
    "pad status",
    "pad hooks",
    "pad hooks preview:*",
  ].map((c) => `Bash(${c})`),
];

export const hookCommand = (pad: string, name: HookName) => `${pad} hook ${name}`;

// Older installs ran each hook as its own script (`bun …/integrations/claude-code/<script>.ts`).
const SCRIPTS = /integrations\/claude-code\/(session-start|record-edit|review-hook)\.ts$/;

// Matched by shape rather than by path, so entries from an older install (another pad or bun
// path, or the scripts) are found too.
const PAD_HOOK = new RegExp(
  `(^|/)pad hook (${Object.values(HOOKS)
    .map((h) => h.name)
    .join("|")})$`,
);

const isOurs = (h: Hook) => SCRIPTS.test(h.command) || PAD_HOOK.test(h.command);

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
export function withOurs(s: Settings, pad: string): Settings {
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
            command: hookCommand(pad, hook.name),
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
