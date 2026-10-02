import type { Note } from "@/web/lib/api";
import { ago, groupNotes, preview } from "@/web/lib/listing";

/** The notes, grouped by when they changed; `kind` is the filter in force, so it isn't repeated. */
export function NoteList({
  notes,
  currentId,
  kind,
  searching,
  canLoadMore,
  onOpen,
  onLoadMore,
}: {
  notes: Note[];
  currentId: string | undefined;
  kind: string;
  searching: boolean;
  canLoadMore: boolean;
  onOpen: (id: string) => void;
  onLoadMore: () => void;
}) {
  return (
    <nav className="list" aria-label="Notes">
      {groupNotes(notes).map((g) => (
        <section key={g.label} aria-label={g.label}>
          <h2 className="group">{g.label}</h2>
          <ul>
            {g.notes.map((n) => {
              const p = preview(n);
              return (
                <li key={n.id}>
                  {/* A real button, so the list works from the keyboard and screen readers. */}
                  <button
                    className="item"
                    aria-current={currentId === n.id}
                    onClick={() => onOpen(n.id)}
                  >
                    <span className="t">{n.title}</span>
                    {p && <span className="p">{p}</span>}
                    <span className="m">
                      {n.kind === "note" && n.progress.total > 0 && (
                        <span className="done">
                          <progress
                            value={n.progress.done}
                            max={n.progress.total}
                            aria-hidden="true"
                          />
                          {n.progress.done}/{n.progress.total} ·{" "}
                        </span>
                      )}
                      {ago(n.updated_at)}
                      {n.kind === "reference" && kind !== "reference" && (
                        <span className="badge kind">reference</span>
                      )}
                      {n.author !== "human" && <span className="badge">{n.author}</span>}
                      {n.tags.length > 0 && <span> · #{n.tags.join(" #")}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {notes.length === 0 && <p className="m">{searching ? "No matches." : "No notes yet."}</p>}
      {canLoadMore && (
        <button className="more" onClick={onLoadMore}>
          Load more
        </button>
      )}
    </nav>
  );
}
