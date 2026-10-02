// Note ids. Shared because the PWA mints them too: a note written offline needs its final id before
// the server has seen it, so later edits and a retried create all refer to the same note.

/** Sortable, URL-safe id: base36 timestamp + random suffix. */
// What the API accepts as a client-chosen id is the NoteId schema in src/domain.ts.
export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
