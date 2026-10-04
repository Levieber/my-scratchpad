// What the routes share: how a request is read and how a response or a refusal is written.
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Schema from "effect/Schema";

import type {
  DatabaseUnavailable,
  HookLimit,
  NoteChanged,
  NoteExists,
  NoteNotFound,
  PinLimit,
  RevisionNotFound,
  ViewExists,
  ViewNotFound,
} from "@/server/storage/errors";
import type { ListQuery } from "@/server/storage/notes";
import { type Note, NoteInput } from "@/shared/domain";
import { ERROR_MESSAGES, type ErrorBody, type ErrorCode } from "@/shared/errors";
import { isKind, KIND_NAMES } from "@/shared/kinds";
import { parseQuery } from "@/shared/query";
import { failedField, inputProblem } from "@/shared/validation";

export type Request = HttpServerRequest.HttpServerRequest;

/** A request the API refuses, answered as `{ error: code, message }` with `status`. */
export class HttpError extends Data.TaggedError("HttpError")<{
  code: ErrorCode;
  status: number;
  message: string;
}> {}

/** Everything a handler may fail with; each becomes an error response in `guard`. */
export type Failure =
  | HttpError
  | NoteNotFound
  | NoteExists
  | NoteChanged
  | RevisionNotFound
  | ViewNotFound
  | ViewExists
  | PinLimit
  | HookLimit
  | DatabaseUnavailable;

export const refuse = (code: ErrorCode, status: number, detail?: string) =>
  new HttpError({ code, status, message: detail ?? ERROR_MESSAGES[code] });

export const json = (data: unknown, status = 200) =>
  HttpServerResponse.jsonUnsafe(data, { status });
// The note's updated_at is its version: what If-Match compares against.
export const noteJson = (note: Note, status = 200) =>
  HttpServerResponse.jsonUnsafe(note, { status, headers: { etag: `"${note.updated_at}"` } });
export const errorJson = (
  code: ErrorCode,
  status: number,
  message: string = ERROR_MESSAGES[code],
  headers?: Record<string, string>,
) =>
  HttpServerResponse.jsonUnsafe({ error: code, message } satisfies ErrorBody, { status, headers });

export const noContent = HttpServerResponse.empty({ status: 204 });

const isJson = (req: Request) => (req.headers["content-type"] ?? "").includes("application/json");

export const readJson = (req: Request) =>
  Effect.mapError(req.json, () => refuse("invalidJson", 400));

const kindError = () => refuse("invalidKind", 400, `kind must be one of: ${KIND_NAMES.join(", ")}`);

const decodeInput = Schema.decodeUnknownEffect(NoteInput);

export const readInput = (req: Request) =>
  Effect.gen(function* () {
    // Anything else (text/plain, curl -d default form encoding) is treated as the raw body.
    if (!isJson(req)) return { body: yield* Effect.orDie(req.text) } satisfies NoteInput;
    const body = yield* readJson(req);
    // An unknown kind has its own code, so a client can tell it from a malformed body.
    return yield* Effect.mapError(decodeInput(body), (error) =>
      failedField(error) === "kind" ? kindError() : refuse("invalidBody", 400, inputProblem(error)),
    );
  });

export const readAppendText = (req: Request) =>
  Effect.gen(function* () {
    if (!isJson(req)) return yield* Effect.orDie(req.text);
    const body = yield* readJson(req);
    const text = body && typeof body === "object" && "text" in body ? body.text : undefined;
    if (text !== undefined && typeof text !== "string")
      return yield* refuse("invalidBody", 400, "text must be a string");
    return text ?? "";
  });

// The tags of an If-Match or If-None-Match header, as bare strings: weak ones compare by their
// value, which is all a proxy that compresses a response leaves intact.
const entityTags = (header: string) =>
  header.split(",").map((t) =>
    t
      .trim()
      .replace(/^W\//, "")
      .replace(/^"(.*)"$/, "$1"),
  );

/** If-Match against a note: its updated_at, quoted as in the ETag or bare, or `*` for any. */
export function matches(header: string | undefined, note: Note): boolean {
  if (header === undefined) return true;
  const tags = entityTags(header);
  return tags.includes("*") || tags.includes(note.updated_at);
}

const revalidate = (version: string) => ({
  // Weak, since a proxy may compress the body. Cached but checked on every use: a client that
  // can't be sure what changed asks, and gets a 304 instead of the list.
  etag: `W/"${version}"`,
  "cache-control": "private, no-cache",
});

/**
 * A collection that clients poll, answered in full or as a 304 when they hold its current
 * `version` (If-None-Match). A 304 skips serialising the body as well as sending it.
 */
export const polled = <E, R>(version: Effect.Effect<string>, read: Effect.Effect<unknown, E, R>) =>
  Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest;
    // The version is read before the data: a write in between leaves the data newer than its
    // version, and the next poll just asks again. The other order could pin old data to a new one.
    const current = yield* version;
    const held = req.headers["if-none-match"];
    if (held !== undefined) {
      const tags = entityTags(held);
      if (tags.includes("*") || tags.includes(current))
        return HttpServerResponse.empty({ status: 304, headers: revalidate(current) });
    }
    return HttpServerResponse.jsonUnsafe(yield* read, { headers: revalidate(current) });
  });

export const searchParams = (req: Request) => new URL(req.originalUrl).searchParams;

export const positiveInt = (p: URLSearchParams, name: string) =>
  Effect.suspend(() => {
    const value = p.get(name);
    if (value === null) return Effect.succeed(undefined);
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0)
      return Effect.fail(refuse("invalidParam", 400, `${name} must be a revision id`));
    return Effect.succeed(n);
  });

export const authorOf = (req: Request) =>
  req.headers["x-pad-author"]?.trim().slice(0, 64) || "human";

export const page = (p: URLSearchParams) => ({
  limit: Number(p.get("limit") ?? 50) || 50,
  offset: Number(p.get("offset") ?? 0) || 0,
});

/**
 * The list's query string as a store query. An explicit `kind` parameter is checked, since a
 * program sent it; one typed into `q` is not, so a half-typed search just matches nothing.
 */
export const readListQuery = (p: URLSearchParams) =>
  Effect.suspend((): Effect.Effect<ListQuery, HttpError> => {
    const kind = p.get("kind");
    if (kind !== null && !isKind(kind)) return Effect.fail(kindError());
    const parsed = parseQuery(p.get("q") ?? "");
    return Effect.succeed({
      q: parsed.text || undefined,
      kind: kind ?? parsed.kind,
      author: p.get("author") ?? parsed.author,
      tags: [...p.getAll("tag"), ...parsed.tags],
      ...page(p),
    });
  });

export const staticFile = (
  path: string,
  contentType?: string,
  headers: Record<string, string> = {},
) => HttpServerResponse.file(path, { contentType, headers }).pipe(Effect.orDie);

export const routeId = Effect.map(HttpRouter.params, (p) => p.id ?? "");
