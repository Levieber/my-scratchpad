// The Claude Code hooks: `pad hooks` chooses the notes they use, `pad hook <name>` is what Claude
// Code runs.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { HOOK_RUNNERS } from "@integrations/claude-code/hooks";
import * as Argument from "effect/cli/Argument";
import * as Command from "effect/cli/Command";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { line } from "@/cli/format";
import { out, reported } from "@/cli/root";
import { Client } from "@/client/client";
import { HOOK_QUERIES, HookConfig, type HookQueryName } from "@/config/hooks";

const HOOK_NAMES = Object.keys(HOOK_QUERIES) as HookQueryName[];

const saveChosen = (path: string, chosen: Partial<Record<HookQueryName, string>>) =>
  Effect.sync(() => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(chosen, null, 2) + "\n");
  });

/** The notes a hook would put in front of Claude now, so a choice shows what it does. */
const previewNotes = Effect.fn(function* (name: HookQueryName, query: string) {
  const notes = yield* (yield* Client).list({
    q: query,
    limit: name === "session-start" ? 8 : 100,
  });
  return notes.length ? notes.map(line).join("\n") : "(no notes match: the hook adds nothing)";
});

export const hooks = Command.make(
  "hooks",
  {},
  Effect.fn(function* () {
    const { path, chosen, queries } = yield* HookConfig;
    yield* out({ path, queries, chosen }, () =>
      HOOK_NAMES.map(
        (name) => `${name.padEnd(15)}${queries[name]}${name in chosen ? "" : "  (default)"}`,
      ).join("\n"),
    );
  }, reported),
).pipe(
  Command.withDescription("Which notes the Claude Code hooks use (session-start, review)"),
  Command.withSubcommands([
    Command.make(
      "set",
      {
        hook: Argument.Literals("hook", HOOK_NAMES),
        query: Argument.String("query").pipe(Argument.atLeast(1)),
      },
      Effect.fn(function* (a) {
        const { path, chosen } = yield* HookConfig;
        const query = a.query.join(" ");
        yield* saveChosen(path, { ...chosen, [a.hook]: query });
        const preview = yield* previewNotes(a.hook, query);
        yield* out({ hook: a.hook, query, saved: path }, () => `${a.hook}: ${query}\n${preview}`);
      }, reported),
    ).pipe(
      Command.withDescription(
        "Choose the notes a hook uses, as a search: pad hooks set session-start '#pinned'",
      ),
    ),
    Command.make(
      "reset",
      { hook: Argument.Literals("hook", HOOK_NAMES).pipe(Argument.optional) },
      Effect.fn(function* (a) {
        const { path, chosen } = yield* HookConfig;
        const rest = Option.match(a.hook, {
          onNone: () => ({}),
          onSome: (name) => Object.fromEntries(Object.entries(chosen).filter(([k]) => k !== name)),
        });
        yield* saveChosen(path, rest);
        yield* out({ chosen: rest }, () => "Back to the defaults.");
      }, reported),
    ).pipe(Command.withDescription("Back to the default notes (every hook, or just one)")),
  ]),
);

// Claude Code runs these (see integrations/claude-code/settings.ts); they live in the CLI so they
// start as fast as the compiled `pad` does.
export const hook = Command.make("hook").pipe(
  Command.withDescription(
    "Claude Code hooks, run by Claude Code (installed by `bun run setup:claude`)",
  ),
  Command.withSubcommands(
    Object.entries(HOOK_RUNNERS).map(([name, run]) =>
      Command.make(
        name,
        {},
        Effect.fn(function* () {
          const event = yield* Effect.promise(() => Bun.stdin.json().catch(() => ({})));
          // Hooks only read; attributed as Claude Code all the same.
          yield* run(event).pipe(Effect.provide(Client.layer("claude-code")));
        }),
      ),
    ),
  ),
);
