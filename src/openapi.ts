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
    title: { type: "string", description: "Defaults to the first line of body" },
    body: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    pinned: { type: "boolean" },
    kind: { ...kind, default: "note" },
  },
};

const idParam = { name: "id", in: "path", required: true, schema: { type: "string" } };
const json = (schema: object) => ({ content: { "application/json": { schema } } });
const notFound = { description: "Not found", ...json({ $ref: "#/components/schemas/Error" }) };

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
              "Full-text search. `kind:<kind>` and `#<tag>` narrow it, e.g. `kind:reference #launch seo`",
          },
          { name: "kind", in: "query", schema: { type: "string", enum: KIND_NAMES } },
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
          201: { description: "Created", ...json({ $ref: "#/components/schemas/Note" }) },
        },
      },
    },
    "/api/notes/{id}": {
      parameters: [idParam],
      get: {
        operationId: "getNote",
        summary: "Get one note",
        responses: {
          200: { description: "Note", ...json({ $ref: "#/components/schemas/Note" }) },
          404: notFound,
        },
      },
      patch: {
        operationId: "updateNote",
        summary: "Update fields of a note (omitted fields are unchanged)",
        requestBody: { required: true, ...json({ $ref: "#/components/schemas/NoteInput" }) },
        responses: {
          200: { description: "Note", ...json({ $ref: "#/components/schemas/Note" }) },
          404: notFound,
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
        responses: {
          200: { description: "Note", ...json({ $ref: "#/components/schemas/Note" }) },
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
          200: { description: "Existing review", ...json({ $ref: "#/components/schemas/Note" }) },
          201: { description: "Created", ...json({ $ref: "#/components/schemas/Note" }) },
          400: { description: "Bad date", ...json({ $ref: "#/components/schemas/Error" }) },
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
- GET    /api/notes?q=&kind=&tag=&pinned=&limit=&offset=   list / full-text search
- POST   /api/notes            {title?, body, tags?, pinned?, kind?}  (or text/plain body)
- GET    /api/notes/{id}
- PATCH  /api/notes/{id}       {title?, body?, tags?, pinned?, kind?}
- POST   /api/notes/{id}/append {text}  (or text/plain)
- DELETE /api/notes/{id}
- PUT    /api/daily/{YYYY-MM-DD}  the daily review for the user's local date (created on first request)
- GET    /api/tags

Every note carries \`progress: {done, total}\`, counted from its markdown checkboxes.

## Kinds and search
${KIND_NAMES.map((k) => `- ${k}: ${KINDS[k]}`).join("\n")}
A use case is a tag, not a kind. \`q\` takes operators: \`kind:reference #checklist #launch\` finds launch checklists; repeat \`tag=\` to require several tags.

## Errors
Non-2xx responses are \`{ "error": "<code>", "message": "<english>" }\`. Branch on the code:
${ERROR_CODES.join(", ")}.

## Example
curl -s ${base}/api/notes -H 'X-Pad-Author: my-agent' -d 'Remember: rotate the API key on Friday'
curl -s '${base}/api/notes?q=api+key'
`;
