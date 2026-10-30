// Note ids. Shared because the PWA mints them too: a note written offline needs its final id before
// the server has seen it, so later edits and a retried create all refer to the same note.

/**
 * What the API accepts as a client-chosen id: URL-safe and long enough not to collide by accident.
 * Here rather than beside the NoteId schema (shared/domain.ts), so the PWA can test an id without
 * bundling Effect's Schema.
 */
export const NOTE_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** Sortable, URL-safe id: base36 timestamp + random suffix. */
export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
