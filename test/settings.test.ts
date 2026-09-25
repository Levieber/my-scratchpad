import { describe, expect, test } from "bun:test";

import {
  ALLOW,
  HOOKS,
  type Settings,
  withOurs,
  withoutOurs,
} from "../integrations/claude-code/settings";

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
    const s = withOurs(mine, "/bin/bun", "/repo");
    expect(commands(s)).toEqual([
      "Stop notify-send done",
      "Stop /bin/bun /repo/integrations/claude-code/review-hook.ts",
      "SessionStart /bin/bun /repo/integrations/claude-code/session-start.ts",
      "PostToolUse Edit|Write|MultiEdit|NotebookEdit /bin/bun /repo/integrations/claude-code/record-edit.ts",
    ]);
    expect(s.model).toBe("opus");
    expect(s.permissions?.allow).toEqual(["Bash(ls:*)", ...ALLOW]);
  });

  test("installing twice, or from another bun path, leaves one copy", () => {
    const twice = withOurs(withOurs(mine, "/old/bun", "/repo"), "/bin/bun", "/repo");
    expect(commands(twice)).toHaveLength(1 + Object.keys(HOOKS).length);
    expect(commands(twice).join("\n")).not.toContain("/old/bun");
    expect(twice.permissions?.allow).toEqual(["Bash(ls:*)", ...ALLOW]);
  });

  test("uninstalling restores the user's settings", () => {
    expect(withoutOurs(withOurs(mine, "/bin/bun", "/repo"))).toEqual(mine);
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
});
