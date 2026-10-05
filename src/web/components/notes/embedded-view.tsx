import type { Embed } from "@/shared/embeds";
import { shownLayout } from "@/shared/layouts";
import { sameTitle } from "@/shared/links";
import { NoteCard } from "@/web/components/notes/note-card";
import { NoteRow } from "@/web/components/notes/note-row";
import { Button } from "@/web/components/ui/button";
import { useEditor } from "@/web/hooks/editor.hook";
import { useNotes, useViews } from "@/web/hooks/notes.hook";
import { useSearch } from "@/web/hooks/search.hook";
import { useWide } from "@/web/hooks/wide.hook";
import { session } from "@/web/lib/session";
import { cn } from "@/web/lib/utils";

/**
 * A `pad-view` block (shared/embeds.ts) shown live in the Read view: its search's notes, as a
 * list or a grid. Layouts that follow the search in force (table, board, pages) show as the
 * list here, as a layout this app doesn't know would.
 */
export function EmbeddedView({ embed }: { embed: Embed }) {
  const views = useViews();
  const view = embed.view ? views.find((v) => sameTitle(v.name, embed.view!)) : undefined;
  const query = embed.query ?? view?.query;
  const label = embed.view ?? embed.query ?? "";
  return (
    <section
      aria-label={`Embedded view: ${label}`}
      className="my-3 rounded-card border border-border p-2 text-base/normal"
    >
      {query === undefined ? (
        <p className="p-1 text-xs text-muted-foreground">No saved view is named “{embed.view}”.</p>
      ) : (
        <Shown
          query={query}
          label={label}
          layout={shownLayout(embed.layout ?? view?.layout ?? null).layout}
          limit={embed.limit}
        />
      )}
    </section>
  );
}

function Shown({
  query,
  label,
  layout,
  limit,
}: {
  query: string;
  label: string;
  layout: string;
  limit: number;
}) {
  const { notes } = useNotes(query, limit);
  const currentId = useEditor().current?.id;
  const { filter } = useSearch();
  const wide = useWide();
  const grid = layout === "grid";
  return (
    <>
      <header className="mb-1 flex items-center gap-2 px-1">
        <h3 className="min-w-0 flex-1 truncate text-xs font-semibold text-muted-foreground">
          {label}
        </h3>
        <Button
          variant="ghost"
          size="xs"
          className="font-normal text-muted-foreground"
          onClick={() => {
            filter(query);
            // A phone shows the note or the list: the search is in the list.
            if (!wide) session.close();
          }}
        >
          Open as search
        </Button>
      </header>
      {notes.length === 0 ? (
        <p className="p-1 text-xs text-muted-foreground">No notes match.</p>
      ) : (
        <ul
          className={cn(
            grid && "grid grid-cols-[repeat(auto-fill,minmax(min(14rem,100%),1fr))] gap-2",
          )}
        >
          {notes.map((n) => {
            const props = { note: n, inPinned: false, current: currentId === n.id, kind: "" };
            return grid ? (
              <NoteCard key={n.id} {...props} />
            ) : (
              <NoteRow key={n.id} {...props} roomy={false} />
            );
          })}
        </ul>
      )}
    </>
  );
}

/** What the Read view hands its renderer to show embedded views. */
export const renderEmbed = (embed: Embed) => <EmbeddedView embed={embed} />;
