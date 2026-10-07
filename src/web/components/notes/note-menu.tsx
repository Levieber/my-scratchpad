import {
  BotIcon,
  BotOffIcon,
  ClipboardCheckIcon,
  EllipsisIcon,
  PinIcon,
  PinOffIcon,
  Trash2Icon,
} from "lucide-react";

import { Button } from "@/web/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/web/components/ui/dropdown-menu";
import { removeNote } from "@/web/hooks/editor.hook";
import { useHookPicks } from "@/web/hooks/hooks-info.hook";
import { usePinOf, usePinToggle } from "@/web/hooks/pins.hook";
import type { Note } from "@/web/lib/api";
import type { PickState } from "@/web/lib/hooks";
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

/**
 * A note's menu: pin, hand-pick for the agent hooks, delete. Its trigger is always visible, as on
 * a phone; hidden until its `group/row` is hovered only on a wide screen with a mouse
 * (desktop-mouse, index.css).
 */
export function NoteMenu({
  note: n,
  className,
  children,
}: {
  note: Note;
  className?: string;
  /** Entries of the layout showing it (a board's "Move to…"), before Delete. */
  children?: React.ReactNode;
}) {
  const togglePin = usePinToggle();
  const picks = useHookPicks();
  const pin = usePinOf()(n.id);
  const session = picks.pickOf?.(n.id, "session-start");
  // A reference is what a review checks edits against; offered for those only.
  const review = n.kind === "reference" ? picks.pickOf?.(n.id, "review") : undefined;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "text-muted-foreground desktop-mouse:size-7 desktop-mouse:opacity-0 desktop-mouse:group-hover/row:opacity-100 desktop-mouse:focus-visible:opacity-100 desktop-mouse:data-popup-open:opacity-100",
              className,
            )}
          />
        }
        aria-label={`Options for "${n.title}"`}
      >
        <EllipsisIcon />
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
        {children}
        <DropdownMenuItem variant="destructive" onClick={() => removeNote(n)}>
          <Trash2Icon />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
