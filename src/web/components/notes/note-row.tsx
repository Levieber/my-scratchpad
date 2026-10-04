import {
  BotIcon,
  BotOffIcon,
  ClipboardCheckIcon,
  EllipsisIcon,
  PinIcon,
  PinOffIcon,
  Trash2Icon,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/web/components/ui/dropdown-menu";
import { openNote, removeNote } from "@/web/hooks/editor.hook";
import { useHookPicks } from "@/web/hooks/hooks-info.hook";
import { usePinOf, usePinToggle } from "@/web/hooks/pins.hook";
import type { Note } from "@/web/lib/api";
import { badge, outlineBadge } from "@/web/lib/classes";
import type { PickState } from "@/web/lib/hooks";
import { ago, preview } from "@/web/lib/listing";
import { cn } from "@/web/lib/utils";

/** A menu entry hand-picking a note for a hook, for everywhere; why it's refused, if it is. */
function PickItem({
  state,
  icon,
  pick,
  unpick,
  onToggle,
}: {
  state: PickState;
  icon: React.ReactNode;
  pick: string;
  unpick: string;
  onToggle: () => void;
}) {
  return (
    <DropdownMenuItem disabled={state.disabled} onClick={onToggle}>
      {state.picked ? <BotOffIcon /> : icon}
      <span>
        {state.picked ? unpick : pick}
        <span className="block text-xs text-muted-foreground">{state.hint}</span>
      </span>
    </DropdownMenuItem>
  );
}

/** One note in the list: the note itself (opens it) and its menu. */
export function NoteRow({
  note: n,
  inPinned,
  current,
  kind,
  roomy,
}: {
  note: Note;
  /** Listed under Pinned, which says so already. */
  inPinned: boolean;
  /** The note open in the editor. */
  current: boolean;
  /** The kind filter in force, so it isn't repeated on every row. */
  kind: string;
  /** The list is the whole screen: previews get a line more. */
  roomy: boolean;
}) {
  const togglePin = usePinToggle();
  const picks = useHookPicks();
  const p = preview(n);
  const pin = usePinOf()(n.id);
  const session = picks.pickOf?.(n.id, "session-start");
  // A reference is what a review checks edits against; offered for those only.
  const review = n.kind === "reference" ? picks.pickOf?.(n.id, "review") : undefined;
  return (
    // The row is the card, holding the note (a button) and its menu trigger at the right edge:
    // one button can't hold another.
    <li
      className={cn(
        "group/row flex items-start rounded-card border border-transparent hover:bg-card",
        current && "border-border bg-card",
      )}
    >
      {/* A real button, so the list works from the keyboard and screen readers. */}
      <button
        className="block min-w-0 flex-1 rounded-card p-2.5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
        aria-current={current}
        onClick={() => void openNote(n.id)}
      >
        <span className="line-clamp-2 font-semibold wrap-anywhere">{n.title}</span>
        {p && (
          <span
            className={cn(
              "line-clamp-2 text-[0.8125rem] text-muted-foreground wrap-anywhere",
              roomy && "line-clamp-3",
            )}
          >
            {p}
          </span>
        )}
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {n.kind === "note" && n.progress.total > 0 && (
            <span>
              <progress
                // Drawn rather than native: Chromium drops the native bar, and with it
                // accent-color, once an element has a border style, which preflight gives all.
                className="mr-1.5 h-1.5 w-12 appearance-none overflow-hidden rounded-full bg-border align-middle [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-border [&::-webkit-progress-value]:bg-primary"
                value={n.progress.done}
                max={n.progress.total}
                aria-hidden="true"
              />
              {n.progress.done}/{n.progress.total} ·{" "}
            </span>
          )}
          {pin.pinned && !inPinned && (
            <PinIcon className="mr-1 inline size-3 align-[-1px]" aria-label="Pinned" />
          )}
          {session?.picked && (
            <BotIcon
              className="mr-1 inline size-3 align-[-1px]"
              aria-label="Shown at session start"
            />
          )}
          {ago(n.updated_at)}
          {n.kind === "reference" && kind !== "reference" && (
            <span className={outlineBadge}>reference</span>
          )}
          {n.author !== "human" && <span className={badge}>{n.author}</span>}
          {n.tags.length > 0 && <span> · #{n.tags.join(" #")}</span>}
        </span>
      </button>
      <DropdownMenu>
        {/* Always visible, as on a phone; hidden until hover only on a wide screen with a mouse
            (desktop-mouse, index.css). */}
        <DropdownMenuTrigger
          className="mt-1 mr-0.5 grid size-9 flex-none place-items-center rounded-lg text-muted-foreground [-webkit-tap-highlight-color:transparent] hover:bg-accent hover:text-foreground data-popup-open:bg-accent data-popup-open:text-foreground desktop-mouse:mt-2 desktop-mouse:mr-1.5 desktop-mouse:size-7 desktop-mouse:opacity-0 desktop-mouse:group-hover/row:opacity-100 desktop-mouse:focus-visible:opacity-100 desktop-mouse:data-popup-open:opacity-100"
          aria-label={`Options for "${n.title}"`}
        >
          <EllipsisIcon className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-44">
          <DropdownMenuItem disabled={pin.disabled} onClick={() => togglePin(n)}>
            {pin.pinned ? <PinOffIcon /> : <PinIcon />}
            <span>
              {pin.pinned ? "Unpin" : "Pin"}
              {pin.disabled && (
                <span className="block text-xs text-muted-foreground">{pin.hint}</span>
              )}
            </span>
          </DropdownMenuItem>
          {session && (
            <PickItem
              state={session}
              icon={<BotIcon />}
              pick="Show at session start"
              unpick="Stop showing at session start"
              onToggle={() => picks.toggle(n, "session-start")}
            />
          )}
          {review && (
            <PickItem
              state={review}
              icon={<ClipboardCheckIcon />}
              pick="Use in reviews"
              unpick="Stop using in reviews"
              onToggle={() => picks.toggle(n, "review")}
            />
          )}
          <DropdownMenuItem variant="destructive" onClick={() => removeNote(n)}>
            <Trash2Icon />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
