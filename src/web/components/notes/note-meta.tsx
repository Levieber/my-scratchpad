import { BotIcon, PinIcon } from "lucide-react";

import { MetaBadge } from "@/web/components/shell/meta-badge";
import { useHookPicks } from "@/web/hooks/hooks-info.hook";
import { usePinOf } from "@/web/hooks/pins.hook";
import type { Note } from "@/web/lib/api";
import { ago } from "@/web/lib/listing";
import { cn } from "@/web/lib/utils";

/** A note's checklist, as a bar and done/total; nothing when it has no tasks or is a reference. */
export function Progress({ note: n }: { note: Note }) {
  if (n.kind !== "note" || n.progress.total === 0) return null;
  return (
    <span>
      <progress
        // Drawn rather than native: Chromium drops the native bar, and with it accent-color,
        // once an element has a border style, which preflight gives all.
        className="mr-1.5 h-1.5 w-12 appearance-none overflow-hidden rounded-full bg-border align-middle [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-border [&::-webkit-progress-value]:bg-primary"
        value={n.progress.done}
        max={n.progress.total}
        aria-hidden="true"
      />
      {n.progress.done}/{n.progress.total}
    </span>
  );
}

/** Pinned, and shown to agents at session start, as icons. */
export function NoteMarks({ note: n, inPinned }: { note: Note; inPinned: boolean }) {
  const pin = usePinOf()(n.id);
  const session = useHookPicks().pickOf?.(n.id, "session-start");
  return (
    <>
      {pin.pinned && !inPinned && (
        <PinIcon className="mr-1 inline size-3 align-[-1px]" aria-label="Pinned" />
      )}
      {session?.picked && (
        <BotIcon className="mr-1 inline size-3 align-[-1px]" aria-label="Shown at session start" />
      )}
    </>
  );
}

/** The line under a note's title: progress, marks, when, kind, author and tags. */
export function NoteMeta({
  note: n,
  inPinned,
  kind,
  tags = n.tags,
  className,
}: {
  note: Note;
  /** The tags to show, when the layout says some already (a board's column). */
  tags?: readonly string[];
  /** Listed under Pinned, which says so already. */
  inPinned: boolean;
  /** The kind filter in force, so it isn't repeated on every note. */
  kind: string;
  className?: string;
}) {
  const progress = n.kind === "note" && n.progress.total > 0;
  return (
    <span className={cn("block text-xs text-muted-foreground", className)}>
      {progress && (
        <>
          <Progress note={n} /> ·{" "}
        </>
      )}
      <NoteMarks note={n} inPinned={inPinned} />
      {ago(n.updated_at)}
      {n.kind === "reference" && kind !== "reference" && (
        <MetaBadge variant="outline" className="ml-1.5">
          reference
        </MetaBadge>
      )}
      {n.author !== "human" && (
        <MetaBadge variant="secondary" className="ml-1.5">
          {n.author}
        </MetaBadge>
      )}
      {tags.length > 0 && <span> · #{tags.join(" #")}</span>}
    </span>
  );
}
