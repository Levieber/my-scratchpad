// The agent hooks: `pad hooks` chooses the notes they show, `pad hook <name>` is what Claude Code
// runs. A choice is kept on the server, for every machine and per place (everywhere, a
// repository, a folder); `--local` keeps a search on this machine only, in hooks.json.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { HOOK_RUNNERS, sectionsText } from "@integrations/claude-code/hooks";
import * as Argument from "effect/cli/Argument";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { id, limit } from "@/cli/flags";
import { line } from "@/cli/format";
import { out, reported, usage } from "@/cli/root";
import { type ApiError, Client } from "@/client/client";
import { hookSections } from "@/client/hook-notes";
import { locate } from "@/client/location";
import { HookConfig } from "@/config/hooks";
import type { HookSection, HookSelection } from "@/shared/domain";
import { HOOK_NAMES, HOOKS, type HookName, normalizeScope, scopeLocation } from "@/shared/hooks";

const hookArg = Argument.Literals("hook", HOOK_NAMES);
const scope = Flag.String("scope").pipe(
  Flag.withDescription(
    "Where it applies: a repository's name, name/folder, or an absolute folder (default: everywhere)",
  ),
  Flag.optional,
);
const here = Flag.Boolean("here").pipe(
  Flag.withDescription("This repository (or this folder, outside one)"),
  Flag.withDefault(false),
);
const local = Flag.Boolean("local").pipe(
  Flag.withDescription("This machine only: its own search in place of the one for everywhere"),
  Flag.withDefault(false),
);

const scopeOf = (a: { scope: Option.Option<string>; here: boolean }) => {
  if (!a.here) return Option.getOrElse(a.scope, () => "");
  const at = locate(process.cwd());
  return at.repo ?? at.dir ?? "";
};

const saveChosen = (path: string, chosen: Partial<Record<HookName, string>>) =>
  Effect.sync(() => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(chosen, null, 2) + "\n");
  });

// The server answers an unknown path with `notFound`: one older than hook selections.
const onServer = <A, R>(effect: Effect.Effect<A, ApiError, R>) =>
  Effect.mapError(effect, (e) =>
    e.code === "notFound"
      ? usage("This server keeps no hook selections yet: update it, or use --local.")
      : e,
  );

const listed = (notes: { length: number }, text: () => string) =>
  notes.length ? text() : "(no notes match: the hook adds nothing)";

/** A stored selection and the notes it picks, so a choice shows what it does. */
const preview = Effect.fn(function* (saved: HookSelection) {
  const { sections } = yield* (yield* Client).hookNotes(saved.hook, scopeLocation(saved.scope));
  const notes = sections.find((s) => s.scope === saved.scope)?.notes ?? [];
  const where = saved.scope ? ` (${saved.scope})` : "";
  return `${saved.hook}${where}: ${saved.query ?? "hand-picked only"}\n${listed(notes, () => notes.map(line).join("\n"))}`;
});

/** Each hook's default, the choices stored on the server, and this machine's own search. */
const describeHooks = Effect.gen(function* () {
  const info = yield* onServer((yield* Client).hooks());
  const { path, chosen } = yield* HookConfig;
  const row = (where: string, what: string) => `  ${where.padEnd(16)}${what}`;
  const text = info.hooks.map((h) => {
    const stored = h.selections.map((s) =>
      row(
        s.scope || "everywhere",
        `${s.query ?? "hand-picked only"}${s.include.length ? `  + ${s.include.length} hand-picked` : ""}  (limit ${s.limit}, by ${s.updated_by})`,
      ),
    );
    const everywhere = h.selections.some((s) => !s.scope)
      ? []
      : [row("everywhere", `${h.default.query}  (default)`)];
    const machine = chosen[h.name as HookName];
    return [
      `${h.name.padEnd(15)}${h.description}`,
      ...everywhere,
      ...stored,
      ...(machine
        ? [row("this machine", `${machine}  (in place of the search for everywhere)`)]
        : []),
    ].join("\n");
  });
  yield* out({ ...info, machine: { path, chosen } }, () => text.join("\n"));
});

export const hooks = Command.make("hooks", {}, () => reported(describeHooks)).pipe(
  Command.withDescription(
    "Which notes the agent hooks show (session-start, review), everywhere and per repository",
  ),
  Command.withSubcommands([
    Command.make(
      "set",
      {
        hook: hookArg,
        query: Argument.String("query").pipe(Argument.atLeast(1)),
        scope,
        here,
        limit,
        local,
      },
      Effect.fn(function* (a) {
        const query = a.query.join(" ");
        if (a.local) {
          if (Option.isSome(a.scope) || a.here || Option.isSome(a.limit))
            return yield* usage(
              "--local is this machine's search for everywhere: no --scope, --here or --limit.",
            );
          const { path, chosen } = yield* HookConfig;
          yield* saveChosen(path, { ...chosen, [a.hook]: query });
          const notes = yield* (yield* Client).list({ q: query, limit: HOOKS[a.hook].limit });
          return yield* out(
            { hook: a.hook, query, saved: path },
            () =>
              `${a.hook} (this machine): ${query}\n${listed(notes, () => notes.map(line).join("\n"))}`,
          );
        }
        const saved = yield* onServer(
          (yield* Client).saveHookSelection(a.hook, {
            scope: scopeOf(a),
            query,
            ...Option.match(a.limit, { onNone: () => ({}), onSome: (n) => ({ limit: n }) }),
          }),
        );
        const text = yield* preview(saved);
        yield* out(saved, () => text);
      }, reported),
    ).pipe(
      Command.withDescription(
        "Choose a hook's notes as a search: pad hooks set session-start '#pinned' [--here]",
      ),
    ),
    Command.make(
      "include",
      { hook: hookArg, id, scope, here },
      Effect.fn(function* (a) {
        const client = yield* Client;
        const where = scopeOf(a);
        yield* onServer(client.pickHookNote(a.hook, a.id, where));
        const stored = normalizeScope(where);
        const saved = (yield* client.hooks()).hooks
          .find((h) => h.name === a.hook)
          ?.selections.find((s) => s.scope === stored);
        const text = saved ? yield* preview(saved) : `picked ${a.id}`;
        yield* out({ hook: a.hook, picked: a.id, scope: where }, () => text);
      }, reported),
    ).pipe(Command.withDescription("Hand-pick a note for a hook: shown first, never cut")),
    Command.make(
      "exclude",
      { hook: hookArg, id, scope, here },
      Effect.fn(function* (a) {
        yield* onServer((yield* Client).unpickHookNote(a.hook, a.id, scopeOf(a)));
        yield* out({ hook: a.hook, unpicked: a.id }, () => `unpicked ${a.id}`);
      }, reported),
    ).pipe(Command.withDescription("Stop hand-picking a note")),
    Command.make(
      "reset",
      { hook: hookArg.pipe(Argument.optional), scope, here, local },
      Effect.fn(function* (a) {
        const names = Option.match(a.hook, { onNone: () => HOOK_NAMES, onSome: (n) => [n] });
        if (a.local) {
          const { path, chosen } = yield* HookConfig;
          const rest = Object.fromEntries(
            Object.entries(chosen).filter(([k]) => !names.includes(k as HookName)),
          );
          yield* saveChosen(path, rest);
          return yield* out({ chosen: rest }, () => "This machine follows the server again.");
        }
        const where = scopeOf(a);
        for (const name of names) yield* onServer((yield* Client).deleteHookSelection(name, where));
        yield* out({ reset: names, scope: where }, () => "Back to the defaults.");
      }, reported),
    ).pipe(
      Command.withDescription(
        "Back to the default (every hook, or one) everywhere or for --scope; --local for this machine",
      ),
    ),
    Command.make(
      "preview",
      { hook: hookArg.pipe(Argument.optional) },
      Effect.fn(function* (a) {
        const names = Option.match(a.hook, { onNone: () => HOOK_NAMES, onSome: (n) => [n] });
        const { chosen } = yield* HookConfig;
        const at = locate(process.cwd());
        const shown: { hook: HookName; sections: HookSection[] }[] = [];
        for (const name of names)
          shown.push({ hook: name, sections: yield* hookSections(name, at, chosen[name]) });
        yield* out({ at, hooks: shown }, () =>
          shown
            .map(
              ({ hook, sections }) =>
                `# ${hook}\n${sectionsText(hook, sections) || "(no notes: the hook adds nothing here)"}`,
            )
            .join("\n\n"),
        );
      }, reported),
    ).pipe(Command.withDescription("What the hooks show an agent working in this folder")),
    Command.make(
      "push",
      {},
      Effect.fn(function* () {
        const { path, chosen } = yield* HookConfig;
        const pushed = Object.entries(chosen) as [HookName, string][];
        for (const [name, query] of pushed)
          yield* onServer((yield* Client).saveHookSelection(name, { query }));
        yield* saveChosen(path, {});
        yield* out({ pushed: Object.fromEntries(pushed) }, () =>
          pushed.length
            ? pushed.map(([name, query]) => `${name}: ${query}`).join("\n")
            : "Nothing to push: this machine has no searches of its own.",
        );
      }, reported),
    ).pipe(
      Command.withDescription("Make this machine's own searches the choice for every machine"),
    ),
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
