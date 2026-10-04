// A note's tags changed from outside the editor's form: a board moving a note between columns.
import type { Note } from "@/web/lib/api";
import type { EditorSession } from "@/web/lib/editor-session";
import { baseOf, fieldsOf, type Outbox } from "@/web/lib/outbox";

/**
 * Gives `note` these tags through the outbox, so it works offline and lands in history. The open
 * note changes through its form, which would otherwise save its old tags back; any other on top
 * of an edit already waiting for it.
 */
export function retag(session: EditorSession, outbox: Outbox, note: Note, tags: string[]) {
  const { open, current } = session.getSnapshot();
  if (open && current?.id === note.id) return session.edit({ tags: tags.join(", ") });
  const waiting = outbox.get(note.id);
  const fields = waiting?.op === "save" ? waiting.fields : fieldsOf(note);
  outbox.save(note.id, { ...fields, tags }, baseOf(note));
  void session.sync();
}
