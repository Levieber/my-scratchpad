import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { HOOK_NAMES, type HookName } from "@/shared/hooks";

import { configFile, readJsonFile } from "./env";

/**
 * This machine's own search for a hook, in place of the one for everywhere: `pad hooks set
 * --local` writes it to `hooks.json`, beside the login file but apart from it, so logging in or
 * out never forgets it. What the user chooses for every machine lives on the server
 * (`pad hooks set`); this is for a machine that should differ.
 */
export class HookConfig extends Context.Service<
  HookConfig,
  {
    readonly path: string;
    /** This machine's search per hook; a hook not listed follows the server. */
    readonly chosen: Partial<Record<HookName, string>>;
  }
>()("pad/HookConfig") {
  static readonly layer = Layer.effect(
    HookConfig,
    Effect.gen(function* () {
      const path = yield* configFile("hooks.json");
      const file = yield* readJsonFile(path);
      const chosen: Partial<Record<HookName, string>> = {};
      for (const name of HOOK_NAMES) {
        const value = file[name];
        if (typeof value === "string" && value.trim()) chosen[name] = value.trim();
      }
      return { path, chosen };
    }),
  );
}
