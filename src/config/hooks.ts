import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { configFile, readJsonFile } from "./env";

/**
 * The notes each Claude Code hook puts in front of Claude, as the search box's language
 * (`kind:x author:x #tag words`, see shared/query.ts) and what applies until the user picks
 * otherwise.
 */
export const HOOK_QUERIES = {
  "session-start": "kind:note",
  review: "kind:reference",
} as const;

export type HookQueryName = keyof typeof HOOK_QUERIES;

/**
 * Which notes the hooks use: `pad hooks set` writes them to `hooks.json`, beside the login file
 * but apart from it, so logging in or out never forgets them. Per machine, like the hooks.
 */
export class HookConfig extends Context.Service<
  HookConfig,
  {
    readonly path: string;
    /** What the user chose; a hook not listed uses its default. */
    readonly chosen: Partial<Record<HookQueryName, string>>;
    /** What each hook uses: the choice, else the default. */
    readonly queries: Record<HookQueryName, string>;
  }
>()("pad/HookConfig") {
  static readonly layer = Layer.effect(
    HookConfig,
    Effect.gen(function* () {
      const path = yield* configFile("hooks.json");
      const file = yield* readJsonFile(path);
      const chosen: Partial<Record<HookQueryName, string>> = {};
      for (const name of Object.keys(HOOK_QUERIES) as HookQueryName[]) {
        const value = file[name];
        if (typeof value === "string" && value.trim()) chosen[name] = value.trim();
      }
      return { path, chosen, queries: { ...HOOK_QUERIES, ...chosen } };
    }),
  );
}
