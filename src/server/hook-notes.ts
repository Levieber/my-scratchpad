// What the hook endpoints read and answer: a hook's selections, where an agent is working, and
// the notes the hook shows it there.
import * as Effect from "effect/Effect";
import * as HttpRouter from "effect/http/HttpRouter";
import * as Option from "effect/Option";

import type { SelectionPatch } from "@/server/storage/hooks";
import type { Store } from "@/server/storage/store";
import type { HookNotes, HookSection, HooksInfo, Note } from "@/shared/domain";
import {
  bySpecificity,
  HOOK_NAMES,
  HOOKS,
  type HookName,
  isHookName,
  type Location,
  MAX_INCLUDE,
  normalizeScope,
  scopeMatches,
} from "@/shared/hooks";
import { parseQuery } from "@/shared/query";

import { type Request, readJson, refuse } from "./http";

export const routeHook = Effect.flatMap(HttpRouter.params, (p) =>
  isHookName(p.name) ? Effect.succeed(p.name) : Effect.fail(refuse("unknownHook", 404)),
);

export const readScope = (raw: unknown) => {
  const scope = typeof raw === "string" ? normalizeScope(raw) : raw == null ? "" : undefined;
  return scope === undefined ? Effect.fail(refuse("invalidScope", 400)) : Effect.succeed(scope);
};

/** `PUT /api/hooks/:name`'s body: the scope it applies to, and the fields it changes. */
export const readSelection = (req: Request) =>
  Effect.gen(function* () {
    const body = yield* readJson(req);
    const invalid = (detail: string) => refuse("invalidBody", 400, detail);
    if (!body || typeof body !== "object" || Array.isArray(body))
      return yield* invalid("Expected an object");
    const { scope, query, include, limit } = body as Record<string, unknown>;
    if (query !== undefined && query !== null && typeof query !== "string")
      return yield* invalid("query must be a string, or null for hand-picked notes only");
    if (include !== undefined && !(Array.isArray(include) && include.every(isString)))
      return yield* invalid("include must be a list of note ids");
    if (limit !== undefined && !(Number.isInteger(limit) && (limit as number) > 0))
      return yield* invalid("limit must be a positive integer");
    const patch: SelectionPatch = {
      query,
      include: include as string[] | undefined,
      limit: limit as number | undefined,
    };
    return { scope: yield* readScope(scope), patch };
  });

const isString = (v: unknown) => typeof v === "string";

export const hooksInfo = (store: Store["Service"]) =>
  Effect.map(store.hookSelections, (all): HooksInfo => ({
    max_include: MAX_INCLUDE,
    hooks: HOOK_NAMES.map((name) => ({
      name,
      description: HOOKS[name].description,
      default: { query: HOOKS[name].query, limit: HOOKS[name].limit },
      max_limit: HOOKS[name].maxLimit,
      selections: all.filter((s) => s.hook === name),
    })),
  }));

/**
 * What `hook` shows an agent at `?repo=&path=&dir=`: every selection that applies there, most
 * specific first and everywhere's last, each with its hand-picked notes and then its search's,
 * up to its limit, and no note twice. `?query=` is a machine's own search for everywhere.
 */
export const hookNotes = Effect.fnUntraced(function* (
  store: Store["Service"],
  hook: HookName,
  params: URLSearchParams,
) {
  const at: Location = {
    repo: params.get("repo") || undefined,
    path: params.get("path") ?? undefined,
    dir: params.get("dir") || undefined,
    home: params.get("home") || undefined,
  };
  const override = params.get("query")?.trim();
  const stored = (yield* store.hookSelections).filter((s) => s.hook === hook);
  const everywhere = stored.find((s) => !s.scope);
  const defaults = HOOKS[hook];

  const applying: Omit<HookSection, "notes">[] = [
    ...stored
      .filter((s) => s.scope && scopeMatches(s.scope, at))
      .toSorted((a, b) => bySpecificity(at)(a.scope, b.scope))
      .map((s) => ({ ...s, source: "user" as const })),
    {
      scope: "",
      query: override || (everywhere ? everywhere.query : defaults.query),
      source: override ? "machine" : everywhere ? "user" : "default",
      limit: everywhere?.limit ?? defaults.limit,
      include: everywhere?.include ?? [],
    },
  ];

  const seen = new Set<string>();
  const sections: HookSection[] = [];
  for (const { scope, query, source, limit, include } of applying) {
    const found = yield* Effect.forEach(include, (id) => Effect.option(store.get(id)));
    const picked = found.flatMap((n) => (Option.isSome(n) ? [n.value] : []));
    let searched: Note[] = [];
    if (query) {
      const { text, kind, author, tags } = parseQuery(query);
      const matches = yield* store.list({
        q: text || undefined,
        kind,
        author,
        tags,
        // Enough to fill the limit after dropping what is already shown.
        limit: limit + seen.size + picked.length,
      });
      searched = matches.filter((n) => !include.includes(n.id) && !seen.has(n.id));
    }
    const notes = [
      ...picked.filter((n) => !seen.has(n.id)),
      ...searched.slice(0, Math.max(0, limit - picked.length)),
    ];
    for (const n of notes) seen.add(n.id);
    sections.push({
      scope,
      query,
      source,
      limit,
      include: picked.map((n) => n.id),
      notes,
    });
  }
  return { hook, sections } satisfies HookNotes;
});
