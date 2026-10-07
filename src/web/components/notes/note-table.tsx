import {
  createColumnHelper,
  createSortedRowModel,
  functionalUpdate,
  rowSortingFeature,
  sortFn_basic,
  type SortingState,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import { useMemo } from "react";

import type { KnownViewOptions } from "@/shared/domain";
import { isObject, TABLE_COLUMNS, type TableColumn } from "@/shared/layouts";
import { ListEnd } from "@/web/components/notes/list-end";
import { NoteMenu } from "@/web/components/notes/note-menu";
import { NoteMarks, Progress } from "@/web/components/notes/note-meta";
import { CoverButton } from "@/web/components/shell/clickable-card";
import { Button } from "@/web/components/ui/button";
import { openNote } from "@/web/hooks/editor.hook";
import type { Listed } from "@/web/hooks/listed.hook";
import { useViewOption } from "@/web/hooks/view-option.hook";
import type { Note } from "@/web/lib/api";
import { ago, tableValue } from "@/web/lib/listing";
import { cn } from "@/web/lib/utils";

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { basic: sortFn_basic },
});
const helper = createColumnHelper<typeof features, Note>();

const LABELS: Record<TableColumn, string> = {
  title: "Title",
  kind: "Kind",
  tags: "Tags",
  author: "Author",
  progress: "Progress",
  updated: "Updated",
};

const columns = helper.columns(
  TABLE_COLUMNS.map((c) =>
    helper.accessor((n) => tableValue(n, c), {
      id: c,
      header: LABELS[c],
      sortFn: "basic",
      // The most done and the latest are what one sorts these by to see first.
      sortDescFirst: c === "progress" || c === "updated",
    }),
  ),
);

type TableSort = NonNullable<KnownViewOptions["sort"]>;

/** A view's `options.sort`, if it is one this app can read (a newer app may have written it). */
const readSort = (value: unknown): TableSort | null =>
  isObject(value) && TABLE_COLUMNS.some((c) => c === value.by)
    ? { by: value.by as TableColumn, desc: value.desc === true }
    : null;

const toSorting = (sort: TableSort | null): SortingState =>
  sort ? [{ id: sort.by, desc: sort.desc ?? false }] : [];

/** A note's value in `column`, as the table shows it. */
function Cell({
  note: n,
  column,
  inPinned,
}: {
  note: Note;
  column: TableColumn;
  inPinned: boolean;
}) {
  switch (column) {
    case "title":
      return (
        <CoverButton className="after:rounded-none" onClick={() => void openNote(n.id)}>
          <NoteMarks note={n} inPinned={inPinned} />
          {n.title}
        </CoverButton>
      );
    case "tags":
      return n.tags.length ? `#${n.tags.join(" #")}` : null;
    case "progress":
      return <Progress note={n} />;
    case "updated":
      return ago(n.updated_at);
    default:
      return n[column];
  }
}

/**
 * The notes as a table, sorted by a column header (kept in the view's `options.sort`). Sorts
 * what is loaded; the server's order (latest first, pinned on top) until a column is chosen.
 */
export function NoteTable({ listed }: { listed: Listed }) {
  const { top, rest, currentId } = listed;
  const data = useMemo(() => [...top, ...rest], [top, rest]);
  const [sort, setSort] = useViewOption("sort", readSort);
  const sorting = toSorting(sort);
  const table = useTable({
    features,
    columns,
    data,
    getRowId: (n) => n.id,
    enableMultiSort: false,
    state: { sorting },
    onSortingChange: (updater) => {
      const [first] = functionalUpdate(updater, sorting);
      setSort(first ? { by: first.id as TableColumn, desc: first.desc } : null);
    },
  });

  return (
    <>
      <table className="w-full border-separate border-spacing-0 text-left text-caption">
        <thead className="sticky top-0 z-10 bg-background">
          <tr>
            {table.getFlatHeaders().map((header) => {
              const dir = header.column.getIsSorted();
              const Arrow = dir === "desc" ? ArrowDownIcon : ArrowUpIcon;
              return (
                <th
                  key={header.id}
                  aria-sort={dir ? (dir === "asc" ? "ascending" : "descending") : undefined}
                  className="border-b border-border p-0 font-medium text-muted-foreground"
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    // The cells' own padding, so a label starts where its column does.
                    className="px-2 text-caption text-muted-foreground"
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    {LABELS[header.column.id as TableColumn]}
                    <Arrow className={cn("size-3.5", !dir && "invisible")} aria-hidden="true" />
                  </Button>
                </th>
              );
            })}
            <th className="border-b border-border">
              <span className="sr-only">Options</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              aria-current={currentId === row.id}
              className="group/row relative hover:bg-card aria-current:bg-card"
            >
              {row.getAllCells().map((cell) => (
                <td
                  key={cell.id}
                  className={cn(
                    "border-b border-border px-2 py-1.5 align-top",
                    cell.column.id === "title" ? "min-w-48" : "text-muted-foreground",
                    cell.column.id === "updated" && "whitespace-nowrap",
                  )}
                >
                  <Cell
                    note={row.original}
                    column={cell.column.id as TableColumn}
                    inPinned={false}
                  />
                </td>
              ))}
              <td className="w-0 border-b border-border py-0.5 pr-1 align-top">
                <NoteMenu note={row.original} className="relative z-10" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ListEnd listed={listed} />
    </>
  );
}
