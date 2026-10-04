// The tools Claude Code gets: names, descriptions and the shape of what each takes. What they do
// is in handlers.ts.
import * as Tool from "effect/ai/Tool";
import * as Toolkit from "effect/ai/Toolkit";
import * as Schema from "effect/Schema";

import { ApiError } from "@/client/client";
import { Kind } from "@/shared/domain";
import { LAYOUT_KEYS } from "@/shared/layouts";

const described = <S extends Schema.Top>(schema: S, description: string) =>
  schema.annotate({ description });

const tags = Schema.optional(
  described(
    Schema.mutable(Schema.Array(Schema.String)),
    "Lowercase tags, e.g. ['project-x', 'todo']",
  ),
);
const kind = Schema.optional(
  described(
    Kind,
    "note (default) or reference (reusable rules: practices, principles, checklists)",
  ),
);
const limit = Schema.optional(
  described(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })), "Default 20"),
);
const id = Schema.String;

// Every tool answers with the API's JSON, and fails with its error message.
const tool = <const Name extends string, Fields extends Schema.Struct.Fields>(
  name: Name,
  description: string,
  fields: Fields,
) =>
  Tool.make(name, {
    description,
    parameters: Schema.Struct(fields),
    success: Schema.Unknown,
    failure: ApiError,
  });

const Search = tool(
  "scratchpad_search",
  "List or full-text search the user's scratchpad notes. Most recently updated first. Returns previews; use scratchpad_get for the full body.",
  {
    query: Schema.optional(
      described(
        Schema.String,
        "Full-text search terms; omit to list recent notes. Also takes `kind:reference`, `author:agent` and `#tag` operators",
      ),
    ),
    tags: Schema.optional(described(Schema.Array(Schema.String), "Notes must carry all of these")),
    kind,
    author: Schema.optional(
      described(Schema.String, "human, agent (anyone who isn't the human), or an author's name"),
    ),
    limit,
  },
)
  .annotate(Tool.Title, "Search scratchpad")
  .annotate(Tool.Readonly, true);

const Get = tool("scratchpad_get", "Get one scratchpad note with its full markdown body.", { id })
  .annotate(Tool.Title, "Read note")
  .annotate(Tool.Readonly, true);

const Create = tool(
  "scratchpad_create",
  "Create a scratchpad note (markdown). Title defaults to the body's first line.",
  { body: Schema.String, title: Schema.optional(Schema.String), tags, kind },
).annotate(Tool.Title, "Create note");

const Append = tool(
  "scratchpad_append",
  "Append text to an existing note on a new line. Prefer this for logs, journals and running lists.",
  { id, text: Schema.String },
).annotate(Tool.Title, "Append to note");

const Update = tool(
  "scratchpad_update",
  "Replace a note's title, body, tags or kind. Omitted fields are unchanged.",
  {
    id,
    title: Schema.optional(Schema.String),
    body: Schema.optional(Schema.String),
    tags,
    kind,
  },
)
  .annotate(Tool.Title, "Update note")
  .annotate(Tool.Idempotent, true);

const History = tool(
  "scratchpad_history",
  "List a note's revisions, newest first: who changed it, when, and how many lines were added/removed. Use scratchpad_diff to see a change.",
  { id, limit },
)
  .annotate(Tool.Title, "Note history")
  .annotate(Tool.Readonly, true);

const Diff = tool(
  "scratchpad_diff",
  "Show what changed in a note as a unified diff (plus title/tags/kind changes). Defaults to the latest change. Pass `since` (e.g. the updated_at you last read) to see everything the user changed after that.",
  {
    id,
    since: Schema.optional(
      described(Schema.String, "ISO date-time; compare with the note as it was then"),
    ),
    from: Schema.optional(described(Schema.Int, "Revision id (from scratchpad_history)")),
    to: Schema.optional(described(Schema.Int, "Revision id; default the latest")),
  },
)
  .annotate(Tool.Title, "Diff note")
  .annotate(Tool.Readonly, true);

const Delete = tool(
  "scratchpad_delete",
  "Permanently delete a scratchpad note. Only do this when the user asks.",
  { id },
)
  .annotate(Tool.Title, "Delete note")
  .annotate(Tool.Destructive, true);

// Tool.make's default parameters: an empty Struct doesn't encode to the object schema MCP needs.
const Views = Tool.make("scratchpad_views", {
  description:
    "The user's saved searches (views): each a name, the query it runs (pass it to scratchpad_search) and the layout the app shows it in.",
  success: Schema.Unknown,
  failure: ApiError,
})
  .annotate(Tool.Title, "Saved views")
  .annotate(Tool.Readonly, true);

const SaveView = tool(
  "scratchpad_save_view",
  "Save a search as a named view in the user's app. Only do this when the user asks.",
  {
    name: described(Schema.String, "Unique, ignoring case"),
    query: described(
      Schema.String,
      "What goes in the search box: words plus `kind:`, `author:` and `#tag` operators",
    ),
    layout: Schema.optional(
      described(
        Schema.Literals(LAYOUT_KEYS),
        `How the app shows it: ${LAYOUT_KEYS.join(", ")}; default: each device's own choice`,
      ),
    ),
  },
).annotate(Tool.Title, "Save view");

// Read only: which notes an agent is shown is the user's choice (`pad hooks`, the PWA).
const Hooks = tool(
  "scratchpad_hooks",
  "What the scratchpad's hooks show you where you work: the note titles that open each session and the references the end-of-turn review checks, by section (everywhere, this repository, a folder), with the user's stored choices.",
  {
    cwd: Schema.optional(
      described(Schema.String, "An absolute folder; default the project you're working in"),
    ),
  },
)
  .annotate(Tool.Title, "Hook notes")
  .annotate(Tool.Readonly, true);

export const Scratchpad = Toolkit.make(
  Search,
  Get,
  Create,
  Append,
  Update,
  History,
  Diff,
  Delete,
  Views,
  SaveView,
  Hooks,
);
