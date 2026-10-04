// The app's one editor session, on the outbox and syncer of this browser (storage.ts), and how
// what it sends settles into the read cache (queries.ts).
import { newId } from "@/shared/ids";
import { token } from "@/web/lib/api";
import { EditorSession } from "@/web/lib/editor-session";
import { needsToken } from "@/web/lib/failures";
import { queryClient, refetchNotes, settle } from "@/web/lib/queries";
import { outbox, syncer } from "@/web/lib/storage";

syncer.onSettled(settle);

export const session = new EditorSession({
  outbox,
  syncer,
  newId,
  onSynced: (result) => {
    if (result.status === "unauthorized") needsToken.set(true);
    if (result.status === "done" || result.status === "error") void refetchNotes();
  },
});

/** The token the person typed: everything refused for want of it is asked and sent again. */
export function provideToken(value: string) {
  token.set(value);
  needsToken.set(false);
  void queryClient.invalidateQueries();
  void session.sync();
}
