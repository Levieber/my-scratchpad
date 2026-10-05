// The agent quick-start served at /llms.txt: what an agent needs to use the API without reading
// the OpenAPI document.
import { ERROR_CODES } from "@/shared/errors";
import { KIND_NAMES, KINDS } from "@/shared/kinds";
import { DIALECT } from "@/shared/markdown";
import { MAX_PINS } from "@/shared/pins";

export const llmsTxt = (base: string) => `# Scratchpad

> A personal scratchpad shared by a human and their AI agents. Plain JSON over HTTP.

Base URL: ${base}
OpenAPI: ${base}/openapi.json
Auth: if the server has PAD_TOKEN set, send \`Authorization: Bearer <token>\`.
Attribution: send \`X-Pad-Author: <agent-name>\` on writes.

## Endpoints
- GET    /api/notes?q=&kind=&author=&tag=&parent=&limit=&offset=   list / full-text search; parent=<id> (or none) lists the pages under it
- POST   /api/notes            {title?, body, tags?, kind?, id?, parent_id?}  (or text/plain body)
- GET    /api/notes/{id}
- PATCH  /api/notes/{id}       {title?, body?, tags?, kind?, parent_id?}  (parent_id null: to the top)
- POST   /api/notes/{id}/append {text}  (or text/plain)
- DELETE /api/notes/{id}
- GET    /api/notes/{id}/backlinks         the notes that link to it with [[its title]] or [[its id]]
- GET    /api/notes/{id}/revisions         history, newest first (who changed it, lines +/-)
- GET    /api/notes/{id}/revisions/{rev}   one revision with its body
- GET    /api/notes/{id}/diff?from=&to=&since=   unified diff; default the latest change
- GET    /api/tags
- GET    /api/views, POST /api/views {name, query, layout?}, PATCH /api/views/{id}, DELETE /api/views/{id}   saved searches and how the app shows them
- GET    /api/hooks   the notes agent hooks show (session start, end-of-turn review), as the user chose them
- GET    /api/hooks/{name}/notes?repo=&path=&dir=&home=   what a hook shows an agent working there, by section
- GET    /api/export?q=&kind=&author=&tag=&history=   the user's notes with their history, views and pins, as one JSON archive (a backup; how to move between deployments)
- POST   /api/import   an archive from /api/export (or a bare array of notes); notes whose id exists are skipped, so importing twice is safe. GET says how large it may be
- GET    /api/pins, PUT /api/pins/{id}, DELETE /api/pins/{id}   the user's pinned notes (at most ${MAX_PINS}): what matters most right now

Every note carries \`progress: {done, total}\`, counted from its markdown checkboxes (outside code fences; an empty \`- [ ]\` is a placeholder, not a task).
Notes nest as pages: \`parent_id\` is the page a note is under (null at the top) and \`subpages\` how many are under it. To file notes under a project page, create them with its \`parent_id\`.

## Note bodies
${DIALECT}
The user reads notes rendered and ticks checkboxes there: a tick changes only that line's \`[ ]\`/\`[x]\`. Write task lists as \`- [ ] item\` so they can be ticked.

## History and concurrent edits
Every change is kept as a revision; saves by one author within 5 minutes are one revision. To see what the user changed since you last read a note, \`GET /api/notes/{id}/diff?since=<the updated_at you read>\`.
Note responses carry \`ETag: "<updated_at>"\`. Send it back as \`If-Match\` on PATCH to refuse overwriting a change made meanwhile (412 noteChanged: fetch, merge, retry). Prefer append for logs: it never conflicts.
List, tags, views and pins carry a weak \`ETag\`; a client that polls sends it back as \`If-None-Match\` and gets \`304\` with no body while nothing was written.

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
