import {
  BotIcon,
  BotOffIcon,
  ClipboardCheckIcon,
  EllipsisIcon,
  PinIcon,
  PinOffIcon,
  Trash2Icon,
} from "lucide-react";

import type { HookName } from "@/shared/hooks";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/web/components/ui/dropdown-menu";
import type { Note } from "@/web/lib/api";
import { badge, moreButton, outlineBadge } from "@/web/lib/classes";
import type { PickState } from "@/web/lib/hooks";
import { ago, groupNotes, preview } from "@/web/lib/listing";
import type { PinState } from "@/web/lib/pins";
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

const heading =
  "mx-2.5 mt-3 mb-1 text-[0.6875rem] font-semibold tracking-wider text-muted-foreground uppercase group-first/section:mt-0";

/**
 * The notes, grouped by when they changed; `kind` is the filter in force, so it isn't repeated.
 * Unless searching, the pinned notes come first and aren't listed again below.
 */
export function NoteList({
  notes,
  pinned,
  pinOf,
  onTogglePin,
  pickOf,
  onTogglePick,
  onDelete,
  currentId,
  kind,
  searching,
  roomy,
  canLoadMore,
  onOpen,
  onLoadMore,
}: {
  notes: Note[];
  pinned: Note[];
  pinOf: (id: string) => PinState;
  onTogglePin: (note: Note) => void;
  /** Undefined when the server keeps no hook choices: the menu then offers none. */
  pickOf: ((id: string, hook: HookName) => PickState) | undefined;
  onTogglePick: (note: Note, hook: HookName) => void;
  onDelete: (note: Note) => void;
  currentId: string | undefined;
  kind: string;
  searching: boolean;
  /** The list is the whole screen: previews get a line more. */
  roomy: boolean;
  canLoadMore: boolean;
  onOpen: (id: string) => void;
  onLoadMore: () => void;
}) {
  const item = (n: Note, inPinned = false) => {
    const p = preview(n);
    const pin = pinOf(n.id);
    const session = pickOf?.(n.id, "session-start");
    // A reference is what a review checks edits against; offered for those only.
    const review = n.kind === "reference" ? pickOf?.(n.id, "review") : undefined;
    return (
      // The row is the card, holding the note (a button) and its menu trigger at the right edge:
      // one button can't hold another.
      <li
        key={n.id}
        className={cn(
          "group/row flex items-start rounded-card border border-transparent hover:bg-card",
          currentId === n.id && "border-border bg-card",
        )}
      >
        {/* A real button, so the list works from the keyboard and screen readers. */}
        <button
          className="block min-w-0 flex-1 rounded-card p-2.5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
          aria-current={currentId === n.id}
          onClick={() => onOpen(n.id)}
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
            <DropdownMenuItem disabled={pin.disabled} onClick={() => onTogglePin(n)}>
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
                onToggle={() => onTogglePick(n, "session-start")}
              />
            )}
            {review && (
              <PickItem
                state={review}
                icon={<ClipboardCheckIcon />}
                pick="Use in reviews"
                unpick="Stop using in reviews"
                onToggle={() => onTogglePick(n, "review")}
              />
            )}
            <DropdownMenuItem variant="destructive" onClick={() => onDelete(n)}>
              <Trash2Icon />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </li>
    );
  };

  const top = searching ? [] : pinned;
  const isTop = new Set(top.map((n) => n.id));
  const rest = notes.filter((n) => !isTop.has(n.id));

  return (
    <nav className="flex-1 overflow-y-auto" aria-label="Notes">
      {top.length > 0 && (
        <section className="group/section" aria-label="Pinned">
          <h2 className={heading}>Pinned</h2>
          <ul>{top.map((n) => item(n, true))}</ul>
        </section>
      )}
      {groupNotes(rest).map((g) => (
        <section key={g.label} className="group/section" aria-label={g.label}>
          <h2 className={heading}>{g.label}</h2>
          <ul>{g.notes.map((n) => item(n))}</ul>
        </section>
      ))}
      {notes.length === 0 && top.length === 0 && (
        <p className="p-2.5 text-xs text-muted-foreground">
          {searching ? "No matches." : "No notes yet."}
        </p>
      )}
      {canLoadMore && (
        <button className={cn(moreButton, "mx-auto my-2 block")} onClick={onLoadMore}>
          Load more
        </button>
      )}
    </nav>
  );
}
