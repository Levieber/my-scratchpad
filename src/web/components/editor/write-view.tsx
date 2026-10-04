import {
  BoldIcon,
  HeadingIcon,
  LinkIcon,
  ListIcon,
  ListTodoIcon,
  TypeIcon,
  type LucideIcon,
} from "lucide-react";
import type { KeyboardEvent } from "react";
import { flushSync } from "react-dom";

import type { NoteEditorProps } from "@/web/components/editor/note-editor";
import { Hint } from "@/web/components/shell/hint";
import { Button } from "@/web/components/ui/button";
import { Textarea } from "@/web/components/ui/textarea";
import { Toggle } from "@/web/components/ui/toggle";
import { bodyRef } from "@/web/hooks/focus";
import { useStore } from "@/web/hooks/store.hook";
import { editorFont } from "@/web/lib/editor-prefs";
import { continueList, link, setLines, type TextSel, wrap } from "@/web/lib/text-edit";
import { cn } from "@/web/lib/utils";

type Edit = (sel: TextSel) => TextSel | null;

const mod = /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl+";

const TOOLS: { label: string; icon: LucideIcon; edit: Edit }[] = [
  { label: `Bold (${mod}B)`, icon: BoldIcon, edit: (s) => wrap(s, "**") },
  { label: "Heading", icon: HeadingIcon, edit: (s) => setLines(s, "heading") },
  { label: "Bulleted list", icon: ListIcon, edit: (s) => setLines(s, "bullet") },
  { label: "Checklist", icon: ListTodoIcon, edit: (s) => setLines(s, "task") },
  { label: `Link (${mod}K)`, icon: LinkIcon, edit: link },
];

// Ctrl/⌘ + a key, in the body only. K here is a link; elsewhere it stays the search (shortcuts.hook.ts).
const KEYS: Record<string, Edit> = {
  b: (s) => wrap(s, "**"),
  i: (s) => wrap(s, "_"),
  k: link,
};

/** The markdown itself, in a textarea, with helpers for those who don't know it. */
export function WriteView({ value, onChange, readOnly }: NoteEditorProps) {
  const font = useStore(editorFont);

  /** Applies `edit` to the body and its selection; false when it had nothing to do. */
  const apply = (edit: Edit) => {
    const el = bodyRef.current;
    if (!el || readOnly) return false;
    const next = edit({ value: el.value, start: el.selectionStart, end: el.selectionEnd });
    if (!next) return false;
    // Rendered before the selection is set, or the new text would put the cursor at its end.
    flushSync(() => onChange(next.value));
    el.focus();
    el.setSelectionRange(next.start, next.end);
    return true;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const key = e.key.toLowerCase();
    const edit = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey ? KEYS[key] : undefined;
    if (edit) {
      e.preventDefault();
      apply(edit);
    } else if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      // While an IME composes, Enter picks a candidate.
      if (!e.nativeEvent.isComposing && apply(continueList)) e.preventDefault();
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-0.5" role="toolbar" aria-label="Formatting">
        {TOOLS.map(({ label, icon: Icon, edit }) => (
          <Hint key={label} label={label}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={label.replace(/ \(.*\)$/, "")}
              disabled={readOnly}
              onClick={() => apply(edit)}
            >
              <Icon />
            </Button>
          </Hint>
        ))}
        <Hint label="Proportional font">
          <Toggle
            size="sm"
            className="ml-auto aria-pressed:bg-accent aria-pressed:text-primary"
            aria-label="Proportional font"
            pressed={font === "sans"}
            onPressedChange={(on) => editorFont.set(on ? "sans" : "mono")}
          >
            <TypeIcon />
          </Toggle>
        </Hint>
      </div>
      <Textarea
        ref={bodyRef}
        className={cn(
          "min-h-0 flex-1 resize-none p-3.5 text-base/[1.6] field-sizing-fixed",
          font === "mono" ? "font-mono" : "font-sans",
        )}
        aria-label="Body"
        placeholder="Write anything. Markdown welcome."
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
    </>
  );
}
