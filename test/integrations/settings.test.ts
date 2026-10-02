import { describe, expect, test } from "bun:test";

import {
  ALLOW,
  HOOKS,
  type Settings,
  withOurs,
  withoutOurs,
} from "@integrations/claude-code/settings";

const mine: Settings = {
  model: "opus",
  hooks: { Stop: [{ hooks: [{ type: "command", command: "notify-send done" }] }] },
  permissions: { allow: ["Bash(ls:*)"] },
};

const commands = (s: Settings) =>
  Object.entries(s.hooks ?? {}).flatMap(([event, groups]) =>
    groups.flatMap((g) =>
      g.hooks.map((h) => [event, g.matcher, h.command].filter(Boolean).join(" ")),
    ),
  );

describe("installer settings", () => {
  test("installing adds one entry per hook and keeps the user's own settings", () => {
    const s = withOurs(mine, "/home/u/.local/bin/pad");
    expect(commands(s)).toEqual([
      "Stop notify-send done",
      "Stop /home/u/.local/bin/pad hook review",
      "SessionStart /home/u/.local/bin/pad hook session-start",
      "PostToolUse Edit|Write|MultiEdit|NotebookEdit /home/u/.local/bin/pad hook record-edit",
    ]);
    expect(s.model).toBe("opus");
    expect(s.permissions?.allow).toEqual(["Bash(ls:*)", ...ALLOW]);
  });

  test("installing twice, or from another pad path, leaves one copy", () => {
    const twice = withOurs(withOurs(mine, "/old/pad"), "/bin/pad");
    expect(commands(twice)).toHaveLength(1 + Object.keys(HOOKS).length);
    expect(commands(twice).join("\n")).not.toContain("/old/pad");
    expect(twice.permissions?.allow).toEqual(["Bash(ls:*)", ...ALLOW]);
  });

  test("uninstalling restores the user's settings", () => {
    expect(withoutOurs(withOurs(mine, "/bin/pad"))).toEqual(mine);
  });

  test("an earlier install with only the SessionStart hook is upgraded cleanly", () => {
    const old: Settings = {
      hooks: {
        SessionStart: [
          {
            hooks: [
              { type: "command", command: "/b/bun /r/integrations/claude-code/session-start.ts" },
            ],
          },
        ],
      },
    };
    expect(commands(withoutOurs(old))).toEqual([]);
  });

  test("an install that ran each hook as a script is replaced by the pad hooks", () => {
    const scripts: Settings = {
      hooks: {
        Stop: [
          {
            hooks: [
              { type: "command", command: "/b/bun /r/integrations/claude-code/review-hook.ts" },
            ],
          },
        ],
        PostToolUse: [
          {
            matcher: "Edit|Write|MultiEdit|NotebookEdit",
            hooks: [
              { type: "command", command: "/b/bun /r/integrations/claude-code/record-edit.ts" },
            ],
          },
        ],
      },
    };
    expect(commands(withOurs(scripts, "/bin/pad")).join("\n")).not.toContain("integrations/");
    expect(commands(withOurs(scripts, "/bin/pad"))).toHaveLength(Object.keys(HOOKS).length);
  });

  test("the user's own hooks that merely mention pad are left alone", () => {
    const own: Settings = {
      hooks: { Stop: [{ hooks: [{ type: "command", command: "pad hook review --dry-run" }] }] },
    };
    expect(withoutOurs(own)).toEqual(own);
  });
});
