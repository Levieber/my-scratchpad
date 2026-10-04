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

import { TABLE_COLUMNS, type TableColumn } from "@/shared/layouts";
import { ListEnd } from "@/web/components/notes/list-end";
import { NoteMenu } from "@/web/components/notes/note-menu";
import { NoteMarks, Progress } from "@/web/components/notes/note-meta";
import { openNote } from "@/web/hooks/editor.hook";
import type { Listed } from "@/web/hooks/listed.hook";
import { type TableSort, useTableSort } from "@/web/hooks/table-sort.hook";
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
        <button
          className="text-left font-semibold wrap-anywhere after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-primary"
          onClick={() => void openNote(n.id)}
        >
          <NoteMarks note={n} inPinned={inPinned} />
          {n.title}
        </button>
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
  const { sort, setSort } = useTableSort();
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
      <table className="w-full border-separate border-spacing-0 text-left text-[0.8125rem]">
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
                  <button
                    className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    {LABELS[header.column.id as TableColumn]}
                    <Arrow className={cn("size-3.5", !dir && "invisible")} aria-hidden="true" />
                  </button>
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
              className="group/row relative hover:bg-card aria-[current=true]:bg-card"
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
