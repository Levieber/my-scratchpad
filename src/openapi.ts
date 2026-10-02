import { ERROR_CODES } from "./errors";
import { KIND_NAMES, KINDS } from "./kinds";

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
    "pinned",
    "kind",
    "author",
    "created_at",
    "updated_at",
    "progress",
  ],
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    body: { type: "string", description: "Markdown" },
    tags: { type: "array", items: { type: "string" } },
    pinned: { type: "boolean" },
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
    pinned: { type: "boolean" },
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
const error = (description: string) => ({
  description,
  ...json({ $ref: "#/components/schemas/Error" }),
});

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
        summary: "List or full-text search notes (pinned first, then most recently updated)",
        parameters: [
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
          { name: "pinned", in: "query", schema: { type: "boolean" } },
          { name: "limit", in: "query", schema: { type: "integer", default: 50, maximum: 500 } },
          { name: "offset", in: "query", schema: { type: "integer", default: 0 } },
        ],
        responses: {
          200: {
            description: "Notes",
            ...json({ type: "array", items: { $ref: "#/components/schemas/Note" } }),
          },
        },
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
    "/api/daily/{date}": {
      parameters: [
        {
          name: "date",
          in: "path",
          required: true,
          schema: { type: "string", format: "date" },
          description: "The user's local date; the server can't know their time zone",
        },
      ],
      put: {
        operationId: "dailyReview",
        summary:
          "Get the daily review for a date, creating it (tag `daily`, open items carried over from the previous review) on first request",
        responses: {
          200: noteResponse("Existing review"),
          201: noteResponse("Created"),
          400: error("Bad date"),
        },
      },
    },
    "/api/tags": {
      get: {
        operationId: "listTags",
        summary: "All tags with usage counts",
        responses: {
          200: {
            description: "Tags",
            ...json({
              type: "array",
              items: {
                type: "object",
                properties: { tag: { type: "string" }, count: { type: "integer" } },
              },
            }),
          },
        },
      },
    },
    "/api/views": {
      get: {
        operationId: "listViews",
        summary: "Saved searches, by name",
        responses: {
          200: {
            description: "Views",
            ...json({ type: "array", items: { $ref: "#/components/schemas/View" } }),
          },
        },
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
    "/api/health": {
      get: {
        operationId: "health",
        summary: "Liveness check",
        security: [{}],
        responses: { 200: { description: "OK" } },
      },
    },
  },
};

export const llmsTxt = (base: string) => `# Scratchpad

> A personal scratchpad shared by a human and their AI agents. Plain JSON over HTTP.

Base URL: ${base}
OpenAPI: ${base}/openapi.json
Auth: if the server has PAD_TOKEN set, send \`Authorization: Bearer <token>\`.
Attribution: send \`X-Pad-Author: <agent-name>\` on writes.

## Endpoints
- GET    /api/notes?q=&kind=&author=&tag=&pinned=&limit=&offset=   list / full-text search
- POST   /api/notes            {title?, body, tags?, pinned?, kind?, id?}  (or text/plain body)
- GET    /api/notes/{id}
- PATCH  /api/notes/{id}       {title?, body?, tags?, pinned?, kind?}
- POST   /api/notes/{id}/append {text}  (or text/plain)
- DELETE /api/notes/{id}
- GET    /api/notes/{id}/revisions         history, newest first (who changed it, lines +/-)
- GET    /api/notes/{id}/revisions/{rev}   one revision with its body
- GET    /api/notes/{id}/diff?from=&to=&since=   unified diff; default the latest change
- PUT    /api/daily/{YYYY-MM-DD}  the daily review for the user's local date (created on first request)
- GET    /api/tags
- GET    /api/views, POST /api/views {name, query}, DELETE /api/views/{id}   saved searches

Every note carries \`progress: {done, total}\`, counted from its markdown checkboxes.

## History and concurrent edits
Every change is kept as a revision; saves by one author within 5 minutes are one revision. To see what the user changed since you last read a note, \`GET /api/notes/{id}/diff?since=<the updated_at you read>\`.
Note responses carry \`ETag: "<updated_at>"\`. Send it back as \`If-Match\` on PATCH to refuse overwriting a change made meanwhile (412 noteChanged: fetch, merge, retry). Prefer append for logs: it never conflicts.

## Kinds and search
${KIND_NAMES.map((k) => `- ${k}: ${KINDS[k]}`).join("\n")}
A use case is a tag, not a kind. \`q\` takes operators: \`kind:reference #checklist #launch\` finds launch checklists; repeat \`tag=\` to require several tags. \`author:human\`, \`author:agent\` (anyone who isn't the human) or \`author:<name>\` narrows by who created the note.

## Errors
Non-2xx responses are \`{ "error": "<code>", "message": "<english>" }\`. Branch on the code:
${ERROR_CODES.join(", ")}.

## Example
curl -s ${base}/api/notes -H 'X-Pad-Author: my-agent' -d 'Remember: rotate the API key on Friday'
curl -s '${base}/api/notes?q=api+key'
`;
