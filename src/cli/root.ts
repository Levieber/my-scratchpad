// The `pad` root command and what every command does with its result: print it (or JSON with
// --json) and turn an API failure into one line and exit status 1.
import * as Command from "effect/cli/Command";
import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { json } from "@/cli/flags";
import { ApiError } from "@/client/client";
import { KIND_NAMES } from "@/shared/kinds";

// Who `pad` writes as: PAD_AUTHOR, else claude-code when Claude Code runs it, else the human.
export const Author = Config.all([
  Config.option(Config.String("PAD_AUTHOR")),
  Config.option(Config.String("CLAUDECODE")),
]).pipe(
  Config.map(([author, claude]) =>
    Option.getOrElse(author, () => (Option.isSome(claude) ? "claude-code" : "human")),
  ),
);

export const pad = Command.make("pad").pipe(
  Command.withSharedFlags({ json }),
  Command.withDescription(
    `pad — scratchpad CLI.

Import keeps ids, authors, dates and history, so re-importing skips notes that exist and changes nothing.
Kinds: ${KIND_NAMES.join(", ")}. Search operators: pad ls kind:reference author:agent '#launch' seo (author: human, agent, or a name)
Env (overrides \`pad login\`): PAD_URL, PAD_TOKEN, PAD_AUTHOR.`,
  ),
);

export const usage = (message: string) => new ApiError({ status: 400, message });

/** API errors become one line on stderr (or a JSON error with --json) and exit status 1. */
export const reported = <A, E, R>(effect: Effect.Effect<A, E | ApiError, R>) =>
  Effect.catchIf(
    effect,
    (e): e is ApiError => e instanceof ApiError,
    (e) =>
      Effect.flatMap(pad, ({ json }) =>
        Console.error(json ? JSON.stringify({ error: e.message }) : `pad: ${e.message}`),
      ).pipe(Effect.andThen(Effect.sync(() => void (process.exitCode = 1)))),
    Effect.fail,
  );

/** Prints `data` as JSON with --json, else as `human()` says. */
export const out = (data: unknown, human: () => string) =>
  Effect.flatMap(pad, ({ json }) => Console.log(json ? JSON.stringify(data, null, 2) : human()));

/** The text given as words, else piped on stdin, else "". */
export const textArg = (rest: readonly string[]) =>
  rest.length
    ? Effect.succeed(rest.join(" "))
    : process.stdin.isTTY
      ? Effect.succeed("")
      : Effect.promise(() => Bun.stdin.text()).pipe(Effect.map((t) => t.replace(/\n$/, "")));
