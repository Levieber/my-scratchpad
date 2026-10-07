import { useState } from "react";

import { MetaBadge } from "@/web/components/shell/meta-badge";
import { Row } from "@/web/components/shell/row";
import { Button } from "@/web/components/ui/button";
import { historyError, loadRevision, useDiff, useRevisions } from "@/web/hooks/history.hook";
import type { FullRevision } from "@/web/lib/api";
import { ago } from "@/web/lib/listing";
import { cn } from "@/web/lib/utils";

// The unified diff's own header names the revisions, which the panel already shows.
const diffRows = (diff: string) =>
  diff
    .split("\n")
    .filter((line, i) => line && !(i < 2 && /^(---|\+\+\+) /.test(line)))
    .map((line) => ({
      line,
      kind: (line.startsWith("@@")
        ? "hunk"
        : line[0] === "+"
          ? "add"
          : line[0] === "-"
            ? "del"
            : "ctx") as keyof typeof ROW,
    }));

const ROW = {
  hunk: "mt-1.5 text-muted-foreground",
  add: "bg-success/14",
  del: "bg-destructive/14",
  ctx: "",
};

const meta = "text-xs text-muted-foreground";

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
  const { data: revisions, error: listError } = useRevisions(noteId);
  // The latest revision until the person chooses another.
  const [chosen, setChosen] = useState<number | null>(null);
  const selected = chosen ?? revisions?.[0]?.id ?? null;
  const { data: diff, error: diffError } = useDiff(noteId, selected);
  const [restoreError, setRestoreError] = useState<unknown>(null);

  const restore = async () => {
    if (selected === null) return;
    try {
      onRestore(await loadRevision(noteId, selected));
    } catch (e) {
      setRestoreError(e);
    }
  };

  const error = listError ?? diffError ?? restoreError;
  if (error) return <p className={cn("flex-1", meta)}>{historyError(error)}</p>;
  if (!revisions) return <p className={cn("flex-1", meta)}>Loading history…</p>;

  return (
    // Revisions on the left, the selected change on the right; stacked where the editor is narrow
    // (a phone, or a wide screen with the list beside it), as wide as the editor's own column.
    <section
      className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,30%)_1fr] gap-3 @xl/editor:grid-cols-[minmax(160px,220px)_minmax(0,1fr)] @xl/editor:grid-rows-none"
      aria-label="History"
    >
      <ol className="overflow-y-auto">
        {revisions.map((r, i) => (
          <li key={r.id}>
            <Row
              render={(props) => <button type="button" {...props} />}
              current={r.id === selected}
              className="block w-full px-2.5 py-2 text-left"
              aria-current={r.id === selected}
              onClick={() => setChosen(r.id)}
            >
              <span className="block text-sm font-semibold">
                {ago(r.updated_at)}
                {i === 0 && (
                  <MetaBadge variant="outline" className="ml-1.5">
                    current
                  </MetaBadge>
                )}
              </span>
              <span className={meta}>
                {r.author} · <span className="text-success">+{r.added}</span>{" "}
                <span className="text-destructive">−{r.removed}</span>
              </span>
            </Row>
          </li>
        ))}
      </ol>
      <div className="flex min-h-0 min-w-0 flex-col gap-2">
        {diff?.to.id === selected && (
          <>
            <header className="flex items-center justify-between gap-2">
              <span className={meta}>
                {new Date(diff.to.updated_at).toLocaleString()} by {diff.to.author}
                {!diff.from && " · created"}
              </span>
              {diff.to.id !== revisions[0]?.id && (
                <Button variant="outline" size="sm" onClick={() => void restore()}>
                  Restore this version
                </Button>
              )}
            </header>
            {Object.entries(diff.changes).map(([field, c]) => (
              <p key={field} className={meta}>
                {field}: <del>{show(c.from)}</del> →{" "}
                <ins className="text-success no-underline">{show(c.to)}</ins>
              </p>
            ))}
            {diff.diff ? (
              <figure
                className="m-0 flex-1 overflow-auto rounded-lg border border-border bg-card py-2 font-mono text-caption"
                aria-label="Changes to the text"
              >
                {diffRows(diff.diff).map((row, i) => (
                  <div
                    key={i}
                    className={cn("px-3 whitespace-pre-wrap wrap-anywhere", ROW[row.kind])}
                  >
                    {row.line}
                  </div>
                ))}
              </figure>
            ) : (
              <p className={meta}>The text didn't change.</p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
