import { operatorValue, setOperator } from "@/shared/query";
import { chip } from "@/web/lib/classes";
import { cn } from "@/web/lib/utils";

const KINDS = [
  ["", "All"],
  ["note", "Notes"],
  ["reference", "Reference"],
] as const;

const AUTHORS = [
  ["", "Anyone"],
  ["human", "Me"],
  ["agent", "Agents"],
] as const;

const group = "flex min-w-0 flex-wrap gap-1";
const option = cn(chip, "rounded-lg px-3 py-[3px] text-[0.8125rem]");

/** The kind and author chips: they edit the search box, so the query stays the one source. */
export function Filters({ q, onFilter }: { q: string; onFilter: (next: string) => void }) {
  const kind = operatorValue(q, "kind");
  const author = operatorValue(q, "author");
  return (
    // Kind and author share a row, wrapping on a narrow sidebar.
    <div className="flex flex-wrap gap-x-3.5 gap-y-1.5">
      <fieldset className={group} aria-label="Kind">
        {KINDS.map(([k, label]) => (
          <button
            key={k}
            className={option}
            aria-pressed={kind === k}
            onClick={() => onFilter(setOperator(q, "kind", k))}
          >
            {label}
          </button>
        ))}
      </fieldset>
      <fieldset className={group} aria-label="Author">
        {AUTHORS.map(([a, label]) => (
          <button
            key={a}
            className={option}
            aria-pressed={author === a}
            onClick={() => onFilter(setOperator(q, "author", a))}
          >
            {label}
          </button>
        ))}
      </fieldset>
    </div>
  );
}
