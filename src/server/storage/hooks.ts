// Hook selections: which notes each agent hook shows, per scope (shared/hooks.ts).
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as SqlClient from "effect/sql/SqlClient";

import type { HookSelection } from "@/shared/domain";
import { HOOKS, type HookName, MAX_INCLUDE } from "@/shared/hooks";

import { HookLimit, NoteNotFound } from "./errors";
import { nowIso, run } from "./sql";

const SelectionRow = Schema.Struct({
  hook: Schema.String,
  scope: Schema.String,
  query: Schema.NullOr(Schema.String),
  include: Schema.fromJsonString(Schema.mutable(Schema.Array(Schema.String))),
  note_limit: Schema.Number,
  updated_at: Schema.String,
  updated_by: Schema.String,
});

const decodeSelection = (row: unknown): Effect.Effect<HookSelection> =>
  Schema.decodeUnknownEffect(SelectionRow)(row).pipe(
    Effect.map(({ note_limit, ...selection }) => ({ ...selection, limit: note_limit })),
    Effect.orDie,
  );

/** What a write may change; a field left out keeps its stored (or default) value. */
export type SelectionPatch = { query?: string | null; include?: readonly string[]; limit?: number };

export const makeHooks = (sql: SqlClient.SqlClient) => {
  const find = (hook: HookName, scope: string) =>
    Effect.flatMap(
      sql`SELECT * FROM hook_selections WHERE hook = ${hook} AND scope = ${scope}`,
      (rows) => (rows[0] ? decodeSelection(rows[0]) : Effect.succeed(undefined)),
    );

  const existing = (ids: readonly string[]) =>
    ids.length
      ? Effect.map(
          sql<{ id: string }>`SELECT id FROM notes WHERE id IN ${sql.in(ids)}`,
          (rows) => new Set(rows.map((r) => r.id)),
        )
      : Effect.succeed(new Set<string>());

  /**
   * Writes a selection over what is stored, or over the default: the hook's search for
   * everywhere, hand-picked notes only for any other scope. A newly picked note must exist; one
   * picked earlier and deleted since is dropped.
   */
  const write = Effect.fnUntraced(function* (
    hook: HookName,
    scope: string,
    patch: SelectionPatch,
    author: string,
  ) {
    const stored = yield* find(hook, scope);
    const base = stored ?? {
      query: scope ? null : HOOKS[hook].query,
      include: [] as string[],
      limit: HOOKS[hook].limit,
    };
    const picked = [...new Set(patch.include ?? base.include)];
    const found = yield* existing(picked);
    const missing = picked.find((id) => !found.has(id) && !base.include.includes(id));
    if (missing !== undefined) return yield* new NoteNotFound({ id: missing });
    const include = picked.filter((id) => found.has(id));
    if (include.length > MAX_INCLUDE)
      return yield* new HookLimit({ reason: `At most ${MAX_INCLUDE} hand-picked notes` });
    const limit = patch.limit ?? base.limit;
    if (limit > HOOKS[hook].maxLimit)
      return yield* new HookLimit({
        reason: `${hook} shows at most ${HOOKS[hook].maxLimit} notes`,
      });

    const selection: HookSelection = {
      hook,
      scope,
      query: patch.query === undefined ? base.query : patch.query?.trim() || null,
      include,
      limit,
      updated_at: yield* nowIso,
      updated_by: author,
    };
    const { limit: _, ...row } = selection;
    yield* sql`INSERT INTO hook_selections ${sql.insert({
      ...row,
      include: JSON.stringify(include),
      note_limit: limit,
    })}
               ON CONFLICT (hook, scope) DO UPDATE SET
                 query = excluded.query, include = excluded.include,
                 note_limit = excluded.note_limit, updated_at = excluded.updated_at,
                 updated_by = excluded.updated_by`;
    return selection;
  });

  return {
    /** Every stored selection, by hook and then scope (everywhere's first). */
    hookSelections: run(
      Effect.flatMap(sql`SELECT * FROM hook_selections ORDER BY hook, scope`, (rows) =>
        Effect.forEach(rows, decodeSelection),
      ),
    ),

    saveHookSelection: (hook: HookName, scope: string, patch: SelectionPatch, author: string) =>
      run(write(hook, scope, patch, author).pipe(sql.withTransaction)),

    /** Back to the default; deleting a selection that isn't stored succeeds. */
    deleteHookSelection: (hook: HookName, scope: string) =>
      run(
        Effect.asVoid(sql`DELETE FROM hook_selections WHERE hook = ${hook} AND scope = ${scope}`),
      ),

    /** Picking a picked note changes nothing, so a retried request can't hit the limit. */
    pickHookNote: (hook: HookName, scope: string, id: string, author: string) =>
      run(
        Effect.gen(function* () {
          if (!(yield* existing([id])).has(id)) return yield* new NoteNotFound({ id });
          const stored = yield* find(hook, scope);
          if (stored?.include.includes(id)) return;
          yield* write(hook, scope, { include: [...(stored?.include ?? []), id] }, author);
        }).pipe(sql.withTransaction),
      ),

    /** Unpicking a note that isn't picked succeeds, whether or not the note still exists. */
    unpickHookNote: (hook: HookName, scope: string, id: string, author: string) =>
      run(
        Effect.gen(function* () {
          const stored = yield* find(hook, scope);
          if (!stored?.include.includes(id)) return;
          const include = stored.include.filter((picked) => picked !== id);
          yield* write(hook, scope, { include }, author);
        }).pipe(sql.withTransaction),
      ),
  };
};
