// The agent quick-start served at /llms.txt: what an agent needs to use the API without reading
// the OpenAPI document.
import { ERROR_CODES } from "@/shared/errors";
import { KIND_NAMES, KINDS } from "@/shared/kinds";
import { MAX_PINS } from "@/shared/pins";

export const llmsTxt = (base: string) => `# Scratchpad

> A personal scratchpad shared by a human and their AI agents. Plain JSON over HTTP.

Base URL: ${base}
OpenAPI: ${base}/openapi.json
Auth: if the server has PAD_TOKEN set, send \`Authorization: Bearer <token>\`.
Attribution: send \`X-Pad-Author: <agent-name>\` on writes.

## Endpoints
- GET    /api/notes?q=&kind=&author=&tag=&limit=&offset=   list / full-text search
- POST   /api/notes            {title?, body, tags?, kind?, id?}  (or text/plain body)
- GET    /api/notes/{id}
- PATCH  /api/notes/{id}       {title?, body?, tags?, kind?}
- POST   /api/notes/{id}/append {text}  (or text/plain)
- DELETE /api/notes/{id}
- GET    /api/notes/{id}/revisions         history, newest first (who changed it, lines +/-)
- GET    /api/notes/{id}/revisions/{rev}   one revision with its body
- GET    /api/notes/{id}/diff?from=&to=&since=   unified diff; default the latest change
- GET    /api/tags
- GET    /api/views, POST /api/views {name, query}, DELETE /api/views/{id}   saved searches
- GET    /api/hooks   the notes agent hooks show (session start, end-of-turn review), as the user chose them
- GET    /api/hooks/{name}/notes?repo=&path=&dir=&home=   what a hook shows an agent working there, by section
- GET    /api/pins, PUT /api/pins/{id}, DELETE /api/pins/{id}   the user's pinned notes (at most ${MAX_PINS}): what matters most right now

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
