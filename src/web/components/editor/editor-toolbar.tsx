import {
  ArrowLeftIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PinIcon,
  PinOffIcon,
  Trash2Icon,
} from "lucide-react";

import { Hint } from "@/web/components/shell/hint";
import { Button } from "@/web/components/ui/button";
import { Input } from "@/web/components/ui/input";
import { Toggle } from "@/web/components/ui/toggle";
import { removeNote, useEditor } from "@/web/hooks/editor.hook";
import { useUnsyncedIds } from "@/web/hooks/pending.hook";
import { usePinOf, usePinToggle } from "@/web/hooks/pins.hook";
import { session } from "@/web/lib/session";

/** The editor's top row: back, the list, the title, and what can be done to the note. */
export function EditorToolbar({
  listHidden,
  onToggleList,
}: {
  listHidden: boolean;
  onToggleList: () => void;
}) {
  const { draft, current, showHistory } = useEditor();
  const pin = usePinOf()(current?.id);
  const togglePin = usePinToggle();
  // History and pins live on the server, so a note it hasn't seen yet has neither.
  const unsyncedIds = useUnsyncedIds();
  const unsynced = current ? unsyncedIds.has(current.id) : false;
  const noHistory = !current || unsynced;

  return (
    <header className="flex flex-wrap items-center gap-1">
      <Button variant="ghost" size="icon" aria-label="Back to list" onClick={session.close}>
        <ArrowLeftIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="max-wide:hidden"
        aria-label={listHidden ? "Show note list" : "Hide note list"}
        aria-expanded={!listHidden}
        onClick={onToggleList}
      >
        {listHidden ? <PanelLeftOpenIcon /> : <PanelLeftCloseIcon />}
      </Button>
      <Input
        className="h-auto flex-[1_1_8rem] border-transparent bg-transparent pl-1 text-xl font-bold shadow-none dark:bg-transparent"
        aria-label="Title"
        placeholder="Title"
        value={draft.title}
        onChange={(e) => session.edit({ title: e.target.value })}
      />
      <Hint label="Reference: reusable rules to check work against (practices, checklists)">
        <Toggle
          className="text-[0.8125rem] text-muted-foreground aria-pressed:bg-accent aria-pressed:text-primary"
          pressed={draft.kind === "reference"}
          onPressedChange={(on) => session.edit({ kind: on ? "reference" : "note" })}
        >
          Reference
        </Toggle>
      </Hint>
      <Hint label={pin.hint} disabled={pin.disabled}>
        <Toggle
          className="aria-pressed:bg-accent aria-pressed:text-primary"
          aria-label={pin.pinned ? "Unpin" : "Pin"}
          pressed={pin.pinned}
          disabled={pin.disabled}
          onPressedChange={() => current && togglePin(current)}
        >
          {pin.pinned ? <PinOffIcon /> : <PinIcon />}
        </Toggle>
      </Hint>
      <Hint
        label={unsynced ? "History starts once the note has synced" : "What changed, and when"}
        disabled={noHistory}
      >
        <Toggle
          className="text-[0.8125rem] text-muted-foreground aria-pressed:bg-accent aria-pressed:text-primary"
          pressed={showHistory}
          disabled={noHistory}
          onPressedChange={() => void session.toggleHistory()}
        >
          History
        </Toggle>
      </Hint>
      <Hint label="Delete">
        <Button
          variant="ghost"
          size="icon"
          className="hover:text-destructive"
          aria-label="Delete"
          onClick={() => removeNote()}
        >
          <Trash2Icon />
        </Button>
      </Hint>
    </header>
  );
}
