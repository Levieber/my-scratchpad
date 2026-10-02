import { useEffect, useState } from "react";

import { api, type FullRevision, type NoteDiff, Offline, type Revision } from "@/web/lib/api";
import { ago } from "@/web/lib/listing";

const describe = (e: unknown) =>
  e instanceof Offline ? "History needs a connection." : e instanceof Error ? e.message : String(e);

// The unified diff's own header names the revisions, which the panel already shows.
const diffRows = (diff: string) =>
  diff
    .split("\n")
    .filter((line, i) => line && !(i < 2 && /^(---|\+\+\+) /.test(line)))
    .map((line) => ({
      line,
      kind: line.startsWith("@@")
        ? "hunk"
        : line[0] === "+"
          ? "add"
          : line[0] === "-"
            ? "del"
            : "ctx",
    }));

// A changed title, kind or tag list as text.
const show = (v: unknown): string => {
  if (Array.isArray(v)) return v.map((t) => `#${String(t)}`).join(" ") || "none";
  return typeof v === "string" ? v : "none";
};

/** A note's revisions, what each changed, and a way back to any of them. */
export function History({
  noteId,
  onRestore,
}: {
  noteId: string;
  onRestore: (revision: FullRevision) => void;
}) {
  const [revisions, setRevisions] = useState<Revision[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [diff, setDiff] = useState<NoteDiff | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    api.revisions(noteId).then(
      (r) => {
        if (!live) return;
        setRevisions(r);
        setSelected(r[0]?.id ?? null);
      },
      (e) => live && setError(describe(e)),
    );
    return () => {
      live = false;
    };
  }, [noteId]);

  // Kept until the next one arrives; only shown while it is the selected revision's.
  useEffect(() => {
    if (selected === null) return;
    let live = true;
    api.diff(noteId, selected).then(
      (d) => live && setDiff(d),
      (e) => live && setError(describe(e)),
    );
    return () => {
      live = false;
    };
  }, [noteId, selected]);

  const restore = async () => {
    if (selected === null) return;
    try {
      onRestore(await api.revision(noteId, selected));
    } catch (e) {
      setError(describe(e));
    }
  };

  if (error) return <p className="history m">{error}</p>;
  if (!revisions) return <p className="history m">Loading history…</p>;

  return (
    <section className="history" aria-label="History">
      <ol className="revisions">
        {revisions.map((r, i) => (
          <li key={r.id}>
            <button
              className="item"
              aria-current={r.id === selected}
              onClick={() => setSelected(r.id)}
            >
              <span className="t">
                {ago(r.updated_at)}
                {i === 0 && <span className="badge kind">current</span>}
              </span>
              <span className="m">
                {r.author} · <span className="add">+{r.added}</span>{" "}
                <span className="del">−{r.removed}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      <div className="change">
        {diff?.to.id === selected && (
          <>
            <header className="bar">
              <span className="m">
                {new Date(diff.to.updated_at).toLocaleString()} by {diff.to.author}
                {!diff.from && " · created"}
              </span>
              {diff.to.id !== revisions[0]?.id && (
                <button onClick={() => void restore()}>Restore this version</button>
              )}
            </header>
            {Object.entries(diff.changes).map(([field, c]) => (
              <p key={field} className="m field">
                {field}: <del>{show(c.from)}</del> → <ins>{show(c.to)}</ins>
              </p>
            ))}
            {diff.diff ? (
              <figure className="diff" aria-label="Changes to the text">
                {diffRows(diff.diff).map((row, i) => (
                  <div key={i} className={row.kind}>
                    {row.line}
                  </div>
                ))}
              </figure>
            ) : (
              <p className="m">The text didn't change.</p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
