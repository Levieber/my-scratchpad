import { ARCHIVE_FORMAT, ARCHIVE_VERSION } from "@/shared/archive";
import { ERROR_CODES } from "@/shared/errors";
import { HOOK_NAMES, MAX_INCLUDE } from "@/shared/hooks";
import { KIND_NAMES, KINDS } from "@/shared/kinds";
import { DIALECT } from "@/shared/markdown";
import { MAX_PINS } from "@/shared/pins";

const kind = {
  type: "string",
  enum: KIND_NAMES,
  description: KIND_NAMES.map((k) => `${k}: ${KINDS[k]}`).join(" "),
};

// The API contract. Every client (PWA, CLI, MCP, curl, other agents) goes through these endpoints.
const Note = {
  type: "object",
  required: [
    "id",
    "title",
    "body",
    "tags",
    "kind",
    "author",
    "created_at",
    "updated_at",
    "progress",
  ],
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    body: { type: "string", description: DIALECT },
    tags: { type: "array", items: { type: "string" } },
    kind,
    author: {
      type: "string",
      description: "Who created it: 'human', 'claude-code', ... (from X-Pad-Author)",
    },
    created_at: { type: "string", format: "date-time" },
    updated_at: { type: "string", format: "date-time" },
    progress: {
      type: "object",
      description: "Markdown checkboxes (`- [ ]`, `- [x]`) in the body, outside code fences",
      required: ["done", "total"],
      properties: { done: { type: "integer" }, total: { type: "integer" } },
      readOnly: true,
    },
  },
};

const NoteInput = {
  type: "object",
  properties: {
    id: {
      type: "string",
      pattern: "^[A-Za-z0-9_-]{8,64}$",
      description:
        "Create only: choose the id yourself (e.g. a note written offline), which makes the create safe to retry: a second POST answers 409 noteExists",
    },
    title: { type: "string", description: "Defaults to the first line of body" },
    body: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    kind: { ...kind, default: "note" },
  },
};

const Revision = {
  type: "object",
  description:
    "A note's content as of updated_at. Saves by one author within 5 minutes are one revision.",
  required: ["id", "note_id", "title", "tags", "kind", "author", "updated_at", "added", "removed"],
  properties: {
    id: { type: "integer" },
    note_id: { type: "string" },
    title: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    kind,
    author: { type: "string", description: "Who made this change (from X-Pad-Author)" },
    updated_at: { type: "string", format: "date-time" },
    added: { type: "integer", description: "Lines added since the previous revision" },
    removed: { type: "integer", description: "Lines removed since the previous revision" },
  },
};

const FullRevision = {
  allOf: [
    { $ref: "#/components/schemas/Revision" },
    { type: "object", required: ["body"], properties: { body: { type: "string" } } },
  ],
};

const fieldChange = { type: "object", properties: { from: {}, to: {} } };

const Diff = {
  type: "object",
  required: ["note_id", "from", "to", "changes", "diff"],
  properties: {
    note_id: { type: "string" },
    from: {
      oneOf: [{ $ref: "#/components/schemas/Revision" }, { type: "null" }],
      description: "null: compared with an empty note (the diff shows the whole body as added)",
    },
    to: { $ref: "#/components/schemas/Revision" },
    changes: {
      type: "object",
      description: "Fields other than the body that differ",
      properties: { title: fieldChange, tags: fieldChange, kind: fieldChange },
    },
    diff: { type: "string", description: "The body as a unified diff; empty when unchanged" },
  },
};

const View = {
  type: "object",
  required: ["id", "name", "query", "created_at"],
  properties: {
    id: { type: "string" },
    name: { type: "string", description: "Unique, ignoring case" },
    query: { type: "string", description: "What goes in the search box, operators included" },
    created_at: { type: "string", format: "date-time" },
  },
};

const scope = {
  type: "string",
  description:
    "Where a selection applies: empty for everywhere, a repository's name (`my-scratchpad`) or a folder inside it (`my-scratchpad/apps/web`), a folder in the home directory (`~/work`, the same on every machine), or an absolute folder (`/srv/notes`). A folder covers every folder below it, repositories included",
};

const HookSelection = {
  type: "object",
  required: ["hook", "scope", "query", "include", "limit", "updated_at", "updated_by"],
  properties: {
    hook: { type: "string", enum: HOOK_NAMES },
    scope,
    query: {
      type: ["string", "null"],
      description: "A search in the search box's language; null for hand-picked notes only",
    },
    include: {
      type: "array",
      items: { type: "string" },
      description: `Hand-picked note ids (at most ${MAX_INCLUDE}), shown first and never cut`,
    },
    limit: { type: "integer", description: "How many notes in all, hand-picked ones included" },
    updated_at: { type: "string", format: "date-time" },
    updated_by: { type: "string", description: "X-Pad-Author of the last change" },
  },
};

const HookSection = {
  type: "object",
  required: ["scope", "query", "source", "limit", "include", "notes"],
  properties: {
    scope,
    query: { type: ["string", "null"] },
    source: {
      type: "string",
      enum: ["default", "user", "machine"],
      description:
        "The hook's default, the user's stored selection, or the caller's own search for everywhere (?query=)",
    },
    limit: { type: "integer" },
    include: { type: "array", items: { type: "string" }, description: "Hand-picked notes found" },
    notes: { type: "array", items: { $ref: "#/components/schemas/Note" } },
  },
};

const hookParam = {
  name: "name",
  in: "path",
  required: true,
  schema: { type: "string", enum: HOOK_NAMES },
};
const scopeParam = {
  name: "scope",
  in: "query",
  schema: scope,
  description: "Default: everywhere",
};

const idParam = { name: "id", in: "path", required: true, schema: { type: "string" } };
const json = (schema: object) => ({ content: { "application/json": { schema } } });
const notFound = { description: "Not found", ...json({ $ref: "#/components/schemas/Error" }) };
const noteResponse = (description: string) => ({
  description,
  headers: {
    ETag: {
      description: "The note's updated_at, quoted; send it back in If-Match",
      schema: { type: "string" },
    },
  },
  ...json({ $ref: "#/components/schemas/Note" }),
});
// The collections a client polls answer 304 to the ETag it already holds.
const ifNoneMatch = {
  name: "If-None-Match",
  in: "header",
  schema: { type: "string" },
  description:
    "The ETag of the last answer: if nothing was written since, the answer is 304 with no body",
};
const ExportedRevision = {
  type: "object",
  description:
    "A revision as written to an archive: content as of updated_at. The list is oldest first; the database's own ids stay out.",
  required: ["title", "body", "tags", "kind", "author", "updated_at"],
  properties: {
    title: { type: "string" },
    body: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    kind,
    author: { type: "string" },
    updated_at: { type: "string", format: "date-time" },
    added: { type: "integer", description: "Counted again from the bodies when left out" },
    removed: { type: "integer", description: "Counted again from the bodies when left out" },
  },
};

// A note as exported: the note without `progress` (derived, so never written), and its history.
const { progress: _progress, ...exportedProperties } = Note.properties;
const ExportedNote = {
  type: "object",
  required: Note.required.filter((name) => name !== "progress"),
  properties: {
    ...exportedProperties,
    revisions: {
      type: "array",
      items: ExportedRevision,
      description: "Oldest first; left out when exported with history=false",
    },
  },
};

const ExportArchive = {
  type: "object",
  description:
    "The portable archive: how a user moves between deployments, and their backup. Specified in docs/export-format.md. Importers read version 1 (a bare array of notes) and 2, ignore fields they don't know, and refuse a version newer than they read.",
  required: ["format", "version", "exported_at", "notes", "views", "pins", "hook_selections"],
  properties: {
    format: { const: ARCHIVE_FORMAT },
    version: { const: ARCHIVE_VERSION },
    exported_at: { type: "string", format: "date-time" },
    source: {
      type: "object",
      description: "Where it came from, for people; never read back",
      properties: { app_version: { type: "string" } },
    },
    notes: { type: "array", items: ExportedNote },
    views: { type: "array", items: { $ref: "#/components/schemas/View" } },
    pins: {
      type: "array",
      description: "In the order they were pinned",
      items: {
        type: "object",
        required: ["note_id", "pinned_at"],
        properties: {
          note_id: { type: "string" },
          pinned_at: { type: "string", format: "date-time" },
        },
      },
    },
    hook_selections: { type: "array", items: { $ref: "#/components/schemas/HookSelection" } },
  },
};

const tally = (description: string) => ({
  type: "object",
  description,
  required: ["created", "skipped"],
  properties: { created: { type: "integer" }, skipped: { type: "integer" } },
});

const ImportResult = {
  type: "object",
  required: ["created", "skipped", "failed", "views", "pins", "hook_selections"],
  properties: {
    created: { type: "integer", description: "Notes written" },
    skipped: {
      type: "integer",
      description: "Notes whose id exists here; left exactly as they were",
    },
    views: tally("Saved searches; one whose name exists is skipped"),
    pins: tally("Pins, only for notes this import created; others are skipped"),
    hook_selections: tally("Hook selections; one for a hook and scope already stored is skipped"),
    failed: {
      type: "array",
      description: "Items that could not be imported, each alone: the rest were",
      items: {
        type: "object",
        required: ["item", "message"],
        properties: {
          item: { type: "string", description: "e.g. `note 3` or `pin <note id>`" },
          message: { type: "string" },
        },
      },
    },
  },
};

const polledResponses = (description: string, schema: object) => ({
  200: {
    description,
    headers: {
      ETag: {
        description:
          "Changes whenever anything is written, not only this collection; send it back in If-None-Match",
        schema: { type: "string" },
      },
    },
    ...json(schema),
  },
  304: { description: "Nothing was written since the ETag in If-None-Match" },
});
const error = (description: string) => ({
  description,
  ...json({ $ref: "#/components/schemas/Error" }),
});

// What narrows the list; the export takes the same, so "export these notes" is the current search.
const listFilters = [
  {
    name: "q",
    in: "query",
    schema: { type: "string" },
    description:
      "Full-text search. `kind:<kind>`, `author:<who>` and `#<tag>` narrow it, e.g. `kind:reference #launch seo` or `author:agent`",
  },
  { name: "kind", in: "query", schema: { type: "string", enum: KIND_NAMES } },
  {
    name: "author",
    in: "query",
    schema: { type: "string" },
    description:
      "`human`, `agent` (anyone who isn't the human) or an author's name such as `claude-code`",
  },
  {
    name: "tag",
    in: "query",
    schema: { type: "array", items: { type: "string" } },
    explode: true,
    description: "Repeat to require several tags",
  },
];

export const openapi = {
  openapi: "3.1.0",
  info: {
    title: "Scratchpad API",
    version: "0.1.0",
    description:
      "API-first scratchpad shared by humans and AI agents. Send `X-Pad-Author: <name>` to attribute writes.",
  },
  servers: [{ url: "/" }],
  components: {
    securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
    schemas: {
      Note,
      NoteInput,
      Revision,
      FullRevision,
      Diff,
      View,
      HookSelection,
      HookSection,
      ExportArchive,
      ImportResult,
      Error: {
        type: "object",
        required: ["error", "message"],
        properties: {
          error: { type: "string", enum: ERROR_CODES, description: "Stable code to branch on" },
          message: { type: "string", description: "English explanation for people and agents" },
        },
      },
    },
  },
  security: [{ bearer: [] }, {}],
  paths: {
    "/api/notes": {
      get: {
        operationId: "listNotes",
        summary: "List or full-text search notes (most recently updated first)",
        parameters: [
          ...listFilters,
          { name: "limit", in: "query", schema: { type: "integer", default: 50, maximum: 500 } },
          { name: "offset", in: "query", schema: { type: "integer", default: 0 } },
          ifNoneMatch,
        ],
        responses: polledResponses("Notes", {
          type: "array",
          items: { $ref: "#/components/schemas/Note" },
        }),
      },
      post: {
        operationId: "createNote",
        summary: "Create a note. Also accepts text/plain (the body becomes the note body).",
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/NoteInput" } },
            "text/plain": { schema: { type: "string" } },
          },
        },
        responses: {
          201: noteResponse("Created"),
          409: error("A note with the given id exists (noteExists)"),
        },
      },
    },
    "/api/notes/{id}": {
      parameters: [idParam],
      get: {
        operationId: "getNote",
        summary: "Get one note",
        responses: { 200: noteResponse("Note"), 404: notFound },
      },
      patch: {
        operationId: "updateNote",
        summary:
          "Update fields of a note (omitted fields are unchanged). Send If-Match with the updated_at you edited to refuse overwriting someone else's change.",
        parameters: [
          {
            name: "If-Match",
            in: "header",
            schema: { type: "string" },
            description:
              "The note's ETag (or bare updated_at) the edit is based on; `*` matches any version",
          },
        ],
        requestBody: { required: true, ...json({ $ref: "#/components/schemas/NoteInput" }) },
        responses: {
          200: noteResponse("Note"),
          404: notFound,
          412: error("The note changed since If-Match (noteChanged): fetch it, merge, retry"),
        },
      },
      delete: {
        operationId: "deleteNote",
        summary: "Delete a note",
        responses: { 204: { description: "Deleted" }, 404: notFound },
      },
    },
    "/api/notes/{id}/append": {
      parameters: [idParam],
      post: {
        operationId: "appendToNote",
        summary: "Append text to a note body on a new line (good for logs/journals)",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["text"],
                properties: { text: { type: "string" } },
              },
            },
            "text/plain": { schema: { type: "string" } },
          },
        },
        responses: { 200: noteResponse("Note"), 404: notFound },
      },
    },
    "/api/notes/{id}/revisions": {
      parameters: [idParam],
      get: {
        operationId: "listRevisions",
        summary: "A note's history, newest first, without bodies",
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", default: 50, maximum: 500 } },
          { name: "offset", in: "query", schema: { type: "integer", default: 0 } },
        ],
        responses: {
          200: {
            description: "Revisions",
            ...json({ type: "array", items: { $ref: "#/components/schemas/Revision" } }),
          },
          404: notFound,
        },
      },
    },
    "/api/notes/{id}/revisions/{rev}": {
      parameters: [
        idParam,
        { name: "rev", in: "path", required: true, schema: { type: "integer" } },
      ],
      get: {
        operationId: "getRevision",
        summary: "One revision with its body (e.g. to restore it with PATCH)",
        responses: {
          200: { description: "Revision", ...json({ $ref: "#/components/schemas/FullRevision" }) },
          404: notFound,
        },
      },
    },
    "/api/notes/{id}/diff": {
      parameters: [idParam],
      get: {
        operationId: "diffNote",
        summary:
          "What changed between two revisions: by default the latest change. `since` shows everything changed after a time.",
        parameters: [
          {
            name: "to",
            in: "query",
            schema: { type: "integer" },
            description: "Revision id; default the latest",
          },
          {
            name: "from",
            in: "query",
            schema: { type: "integer" },
            description: "Revision id; default the one before `to`",
          },
          {
            name: "since",
            in: "query",
            schema: { type: "string", format: "date-time" },
            description:
              "Instead of `from`: compare with the note as it was at this time (e.g. when you last read it)",
          },
        ],
        responses: {
          200: { description: "Diff", ...json({ $ref: "#/components/schemas/Diff" }) },
          400: error("Bad revision id or time (invalidParam)"),
          404: notFound,
        },
      },
    },
    "/api/tags": {
      get: {
        operationId: "listTags",
        summary: "All tags with usage counts",
        parameters: [ifNoneMatch],
        responses: polledResponses("Tags", {
          type: "array",
          items: {
            type: "object",
            properties: { tag: { type: "string" }, count: { type: "integer" } },
          },
        }),
      },
    },
    "/api/views": {
      get: {
        operationId: "listViews",
        summary: "Saved searches, by name",
        parameters: [ifNoneMatch],
        responses: polledResponses("Views", {
          type: "array",
          items: { $ref: "#/components/schemas/View" },
        }),
      },
      post: {
        operationId: "createView",
        summary: "Save a search under a name",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name", "query"],
                properties: { name: { type: "string" }, query: { type: "string" } },
              },
            },
          },
        },
        responses: {
          201: { description: "Created", ...json({ $ref: "#/components/schemas/View" }) },
          400: error("Missing name or query"),
          409: error("A view with this name exists"),
        },
      },
    },
    "/api/views/{id}": {
      delete: {
        operationId: "deleteView",
        summary: "Delete a saved search",
        parameters: [idParam],
        responses: { 204: { description: "Deleted" }, 404: notFound },
      },
    },
    "/api/pins": {
      get: {
        operationId: "listPins",
        summary: `The pinned notes (at most ${MAX_PINS}), in the order they were pinned`,
        parameters: [ifNoneMatch],
        responses: polledResponses("Pinned notes", {
          type: "array",
          items: { $ref: "#/components/schemas/Note" },
        }),
      },
    },
    "/api/pins/{id}": {
      parameters: [idParam],
      put: {
        operationId: "pinNote",
        summary:
          "Pin a note to the home page. Pinning doesn't change the note: not its updated_at, not its history",
        responses: {
          204: { description: "Pinned (or already was)" },
          404: notFound,
          409: error(`${MAX_PINS} notes are pinned already (pinLimit)`),
        },
      },
      delete: {
        operationId: "unpinNote",
        summary: "Unpin a note",
        responses: { 204: { description: "Unpinned (or wasn't pinned)" }, 404: notFound },
      },
    },
    "/api/export": {
      get: {
        operationId: "exportNotes",
        summary:
          "Download the archive: every matching note (not a page) with its history, plus views, pins and hook selections",
        description:
          "Without filters the archive holds everything. With filters it holds only the matching notes (and the pins on them): views and hook selections are the user's own setup, not part of a subset. Answers with `Content-Disposition: attachment`.",
        parameters: [
          ...listFilters,
          {
            name: "history",
            in: "query",
            schema: { type: "boolean", default: true },
            description: "`false` leaves each note's revisions out, for a smaller file",
          },
        ],
        responses: {
          200: {
            description: "The archive",
            ...json({ $ref: "#/components/schemas/ExportArchive" }),
          },
          400: error("invalidKind or invalidParam"),
        },
      },
    },
    "/api/import": {
      get: {
        operationId: "importLimits",
        summary:
          "What an import may send: the archive versions this server reads, and the most bytes",
        responses: {
          200: {
            description: "Limits",
            ...json({
              type: "object",
              required: ["formats", "max_bytes"],
              properties: {
                formats: { type: "array", items: { type: "integer" } },
                max_bytes: { type: "integer", description: "Set by the server's operator" },
              },
            }),
          },
        },
      },
      post: {
        operationId: "importNotes",
        summary: "Import an archive (version 2) or a bare array of notes (version 1)",
        description:
          "Synchronous. A note whose id exists is skipped and left as it is, so importing the same file twice changes nothing. Each note goes in with its revisions, dates and author as the archive has them (the sender's author where it names none), in one transaction: an import can set any author, since authors are display names and are never mapped to accounts. A bad item fails alone and is listed in `failed`; an archive from a newer version is refused whole.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                oneOf: [
                  { $ref: "#/components/schemas/ExportArchive" },
                  { type: "array", items: { $ref: "#/components/schemas/Note" } },
                ],
              },
            },
          },
        },
        responses: {
          200: { description: "Imported", ...json({ $ref: "#/components/schemas/ImportResult" }) },
          400: error("invalidJson or invalidImport"),
          413: error("payloadTooLarge: over the server's limit (see GET)"),
          422: error("unsupportedFormat: an archive newer than this server reads"),
        },
      },
    },
    "/api/hooks": {
      get: {
        operationId: "listHooks",
        summary:
          "The agent hooks that show notes (session start, end-of-turn review): each one's default search and the selections the user stored",
        responses: {
          200: {
            description: "Hooks",
            ...json({
              type: "object",
              required: ["max_include", "hooks"],
              properties: {
                max_include: { type: "integer" },
                hooks: {
                  type: "array",
                  items: {
                    type: "object",
                    required: ["name", "description", "default", "max_limit", "selections"],
                    properties: {
                      name: { type: "string" },
                      description: { type: "string" },
                      default: {
                        type: "object",
                        properties: { query: { type: "string" }, limit: { type: "integer" } },
                      },
                      max_limit: { type: "integer" },
                      selections: {
                        type: "array",
                        items: { $ref: "#/components/schemas/HookSelection" },
                      },
                    },
                  },
                },
              },
            }),
          },
        },
      },
    },
    "/api/hooks/{name}": {
      parameters: [hookParam],
      put: {
        operationId: "saveHookSelection",
        summary:
          "Choose the notes a hook shows where `scope` applies. Fields left out keep their value (or the default: the hook's search for everywhere, hand-picked notes only elsewhere)",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  scope,
                  query: { type: ["string", "null"] },
                  include: { type: "array", items: { type: "string" } },
                  limit: { type: "integer", minimum: 1 },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "Saved", ...json({ $ref: "#/components/schemas/HookSelection" }) },
          400: error("A field has the wrong shape, or the scope can't be one (invalidScope)"),
          404: error("No such hook (unknownHook), or a picked note doesn't exist"),
          409: error("Too many hand-picked notes, or a limit above the hook's (hookLimit)"),
        },
      },
      delete: {
        operationId: "deleteHookSelection",
        summary: "Go back to the default where `scope` applies",
        parameters: [scopeParam],
        responses: {
          204: { description: "Deleted (or wasn't stored)" },
          400: error("invalidScope"),
          404: error("unknownHook"),
        },
      },
    },
    "/api/hooks/{name}/notes": {
      get: {
        operationId: "hookNotes",
        summary:
          "What a hook shows an agent working at a place: every selection that applies there, most specific first, each with its notes; no note twice",
        parameters: [
          hookParam,
          {
            name: "repo",
            in: "query",
            schema: { type: "string" },
            description: "The repository's name",
          },
          {
            name: "path",
            in: "query",
            schema: { type: "string" },
            description: "The folder inside the repository",
          },
          {
            name: "home",
            in: "query",
            schema: { type: "string" },
            description: "The home directory, which `~/` scopes are relative to",
          },
          {
            name: "dir",
            in: "query",
            schema: { type: "string" },
            description: "The absolute folder",
          },
          {
            name: "query",
            in: "query",
            schema: { type: "string" },
            description: "A machine's own search, replacing the one for everywhere",
          },
        ],
        responses: {
          200: {
            description: "Sections",
            ...json({
              type: "object",
              required: ["hook", "sections"],
              properties: {
                hook: { type: "string" },
                sections: { type: "array", items: { $ref: "#/components/schemas/HookSection" } },
              },
            }),
          },
          404: error("unknownHook"),
        },
      },
    },
    "/api/hooks/{name}/include/{id}": {
      parameters: [hookParam, idParam, scopeParam],
      put: {
        operationId: "pickHookNote",
        summary: "Hand-pick a note for a hook where `scope` applies",
        responses: {
          204: { description: "Picked (or already was)" },
          400: error("invalidScope"),
          404: error("No such hook or note"),
          409: error(`${MAX_INCLUDE} notes are hand-picked already (hookLimit)`),
        },
      },
      delete: {
        operationId: "unpickHookNote",
        summary: "Stop hand-picking a note",
        responses: {
          204: { description: "Unpicked (or wasn't picked)" },
          400: error("invalidScope"),
          404: error("unknownHook"),
        },
      },
    },
    "/api/health": {
      get: {
        operationId: "health",
        summary: "Health check: reads the database, so it fails while the database can't answer",
        security: [{}],
        responses: {
          200: { description: "OK" },
          503: { description: "The database is not reachable (error: unavailable)" },
        },
      },
    },
  },
};
