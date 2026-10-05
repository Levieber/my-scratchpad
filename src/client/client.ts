// Typed client over the HTTP API, as an Effect service. The CLI, MCP server and Claude Code hooks
// all use this — never the DB directly.
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import { ClientConfig } from "@/config/client";
import type { ExportArchive, ImportResult } from "@/shared/archive";
import type {
  FullRevision,
  HookNotes,
  HookSelection,
  HooksInfo,
  Note,
  NoteDiff,
  NoteInput,
  Revision,
  NewView,
  Tag,
  View,
  ViewPatch,
} from "@/shared/domain";
import { readError } from "@/shared/errors";
import type { Location } from "@/shared/hooks";

/** `GET /api/notes` parameters. `q` may carry `kind:x`, `author:x` and `#tag` operators. */
export type ListParams = {
  q?: string;
  kind?: string;
  /** `human`, `agent` (anyone else), or an author's name. */
  author?: string;
  /** Notes must carry every one of these. */
  tag?: readonly string[];
  /** Only the notes under this page; `none` for those at the top. */
  parent?: string;
  limit?: number;
  offset?: number;
};

export class ApiError extends Schema.TaggedError<ApiError>()("ApiError", {
  /** The HTTP status; 0 when the server couldn't be reached. */
  status: Schema.Number,
  message: Schema.String,
  /** The API's stable error code (see shared/errors.ts), when the server sent one. */
  code: Schema.optional(Schema.String),
}) {}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

function query(q: Record<string, string | number | boolean | readonly string[] | undefined>) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q))
    for (const one of [v].flat())
      if (one !== undefined && one !== "") params.append(k, String(one));
  const qs = params.toString();
  return qs ? "?" + qs : "";
}

const make = Effect.fnUntraced(function* ({
  url,
  author,
  token,
}: {
  url: string;
  author: string;
  token: Option.Option<Redacted.Redacted>;
}) {
  const http = yield* HttpClient.HttpClient;
  const unreachable = new ApiError({
    status: 0,
    message: `Scratchpad server not reachable at ${url}. Start it with \`pad serve\` or \`systemctl --user start scratchpad\`.`,
  });

  // Responses are trusted, not decoded: the CLI and a deployed server are often different
  // versions, and a field one side doesn't know about shouldn't turn into a failure.
  const req = <T>(method: Method, path: string, body?: unknown) =>
    Effect.gen(function* () {
      let request = HttpClientRequest.make(method)(url + path).pipe(
        HttpClientRequest.setHeader("x-pad-author", author),
      );
      if (Option.isSome(token))
        request = HttpClientRequest.bearerToken(request, Redacted.value(token.value));
      if (body !== undefined) request = HttpClientRequest.bodyJsonUnsafe(request, body);
      const res = yield* Effect.mapError(http.execute(request), () => unreachable);
      if (res.status === 204) return undefined as T;
      const data: unknown = yield* res.json.pipe(Effect.orElseSucceed(() => ({})));
      if (res.status >= 400) {
        const { code, message } = readError(data);
        return yield* new ApiError({ status: res.status, message: message ?? code ?? "", code });
      }
      return data as T;
    });

  const note = (id: string) => `/api/notes/${encodeURIComponent(id)}`;
  const hook = (name: string) => `/api/hooks/${encodeURIComponent(name)}`;

  return {
    list: (q: ListParams = {}) => req<Note[]>("GET", `/api/notes${query(q)}`),
    get: (id: string) => req<Note>("GET", note(id)),
    create: (input: NoteInput) => req<Note>("POST", "/api/notes", input),
    update: (id: string, patch: NoteInput) => req<Note>("PATCH", note(id), patch),
    append: (id: string, text: string) => req<Note>("POST", `${note(id)}/append`, { text }),
    delete: (id: string) => req<void>("DELETE", note(id)),
    tags: () => req<Tag[]>("GET", "/api/tags"),
    views: () => req<View[]>("GET", "/api/views"),
    createView: (view: NewView) => req<View>("POST", "/api/views", view),
    /** Send only what changed: options merge into the view's, so others' survive. */
    updateView: (id: string, patch: ViewPatch) =>
      req<View>("PATCH", `/api/views/${encodeURIComponent(id)}`, patch),
    deleteView: (id: string) => req<void>("DELETE", `/api/views/${encodeURIComponent(id)}`),
    /** The pinned notes, in the order they were pinned. */
    pins: () => req<Note[]>("GET", "/api/pins"),
    pin: (id: string) => req<void>("PUT", `/api/pins/${encodeURIComponent(id)}`),
    unpin: (id: string) => req<void>("DELETE", `/api/pins/${encodeURIComponent(id)}`),
    /** The whole archive (version 2): every note the filters match, with history unless off. */
    exportArchive: (q: Omit<ListParams, "limit" | "offset"> = {}, history = true) =>
      req<ExportArchive>(
        "GET",
        `/api/export${query({ ...q, history: history ? undefined : false })}`,
      ),
    /** An archive, or an array of notes (version 1), as parsed JSON; the server reads it. */
    importArchive: (archive: unknown) => req<ImportResult>("POST", "/api/import", archive),
    health: () => req<{ ok: boolean }>("GET", "/api/health"),
    /** A note's history, newest first. */
    revisions: (id: string, q: { limit?: number; offset?: number } = {}) =>
      req<Revision[]>("GET", `${note(id)}/revisions${query(q)}`),
    revision: (id: string, rev: number) => req<FullRevision>("GET", `${note(id)}/revisions/${rev}`),
    /** The latest change by default; `since` (ISO time) for everything changed after it. */
    diff: (id: string, q: { from?: number; to?: number; since?: string } = {}) =>
      req<NoteDiff>("GET", `${note(id)}/diff${query(q)}`),
    /** Each agent hook's default and the selections the user stored. */
    hooks: () => req<HooksInfo>("GET", "/api/hooks"),
    /** What `name` shows an agent at `at`; `override` is this machine's search for everywhere. */
    hookNotes: (name: string, at: Location, override?: string) =>
      req<HookNotes>("GET", `${hook(name)}/notes${query({ ...at, query: override })}`),
    saveHookSelection: (
      name: string,
      selection: { scope?: string; query?: string | null; include?: string[]; limit?: number },
    ) => req<HookSelection>("PUT", hook(name), selection),
    deleteHookSelection: (name: string, scope = "") =>
      req<void>("DELETE", `${hook(name)}${query({ scope })}`),
    pickHookNote: (name: string, id: string, scope = "") =>
      req<void>("PUT", `${hook(name)}/include/${encodeURIComponent(id)}${query({ scope })}`),
    unpickHookNote: (name: string, id: string, scope = "") =>
      req<void>("DELETE", `${hook(name)}/include/${encodeURIComponent(id)}${query({ scope })}`),
  };
});

export class Client extends Context.Service<Client, Effect.Success<ReturnType<typeof make>>>()(
  "pad/Client",
) {
  /** Against an explicit server, e.g. one a test started. */
  static readonly layerWith = (options: {
    url: string;
    author: string;
    token?: Option.Option<Redacted.Redacted>;
  }) =>
    Layer.effect(Client, make({ token: Option.none(), ...options })).pipe(
      Layer.provide(FetchHttpClient.layer),
    );

  /** Against the configured server (env, then `pad login`), writing as `author`. */
  static readonly layer = (author: string) =>
    Layer.effect(
      Client,
      Effect.gen(function* () {
        const { url, token } = yield* ClientConfig;
        return yield* make({ url, author, token });
      }),
    ).pipe(Layer.provide([ClientConfig.layer, FetchHttpClient.layer]));
}
