// `GET /api/export` and `POST /api/import`: the archive of shared/archive.ts over HTTP.
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import type { Store } from "@/server/storage/store";
import {
  ARCHIVE_FORMAT,
  ARCHIVE_VERSION,
  type ExportArchive,
  parseArchive,
} from "@/shared/archive";

import { openapi } from "./docs/openapi";
import { authorOf, json, readListQuery, refuse, type Request, searchParams } from "./http";

/** `history=false` leaves each note's revisions out; anything but true or false is a mistake. */
const readHistory = (p: URLSearchParams) =>
  Effect.suspend(() => {
    const value = p.get("history");
    if (value === null || value === "true") return Effect.succeed(true);
    if (value === "false") return Effect.succeed(false);
    return Effect.fail(refuse("invalidParam", 400, "history must be true or false"));
  });

/** Every note the list's filters match (not a page of them), as a download. */
export const exportArchive = (store: Store["Service"], req: Request) =>
  Effect.gen(function* () {
    const p = searchParams(req);
    const { limit: _, offset: __, ...query } = yield* readListQuery(p);
    const exportedAt = new Date(yield* Clock.currentTimeMillis).toISOString();
    const archive: ExportArchive = {
      format: ARCHIVE_FORMAT,
      version: ARCHIVE_VERSION,
      exported_at: exportedAt,
      source: { app_version: openapi.info.version },
      ...(yield* store.exportData(query, { history: yield* readHistory(p) })),
    };
    return HttpServerResponse.jsonUnsafe(archive, {
      headers: {
        "content-disposition": `attachment; filename="pad-export-${exportedAt.slice(0, 10)}.json"`,
        "cache-control": "no-store",
      },
    });
  });

/** What a client may ask before importing: the versions this server reads, and the most it takes. */
export const importLimits = (maxBytes: number) =>
  json({ formats: Array.from({ length: ARCHIVE_VERSION }, (_, i) => i + 1), max_bytes: maxBytes });

const tooLarge = (maxBytes: number) =>
  refuse(
    "payloadTooLarge",
    413,
    `The import is larger than this server accepts (${maxBytes} bytes)`,
  );

/**
 * Reads the archive sent, whole, and imports it as the request's author. The size is checked
 * from the declared length before the body is read, and again on what was read, since the
 * declared one can be missing (chunked) or wrong.
 */
export const importArchive = (store: Store["Service"], req: Request, maxBytes: number) =>
  Effect.gen(function* () {
    if (Number(req.headers["content-length"]) > maxBytes) return yield* tooLarge(maxBytes);
    const text = yield* Effect.orDie(req.text);
    if (new TextEncoder().encode(text).length > maxBytes) return yield* tooLarge(maxBytes);
    const data: unknown = yield* Effect.try({
      try: () => JSON.parse(text),
      catch: () => refuse("invalidJson", 400),
    });
    const parsed = parseArchive(data);
    if (!parsed.ok)
      return yield* refuse(
        parsed.code,
        parsed.code === "unsupportedFormat" ? 422 : 400,
        parsed.message,
      );
    return json(yield* store.importArchive(parsed.archive, authorOf(req)));
  });
