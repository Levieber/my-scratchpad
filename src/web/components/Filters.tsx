import { operatorValue, setOperator } from "@/shared/query";

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

/** The kind and author chips: they edit the search box, so the query stays the one source. */
export function Filters({ q, onFilter }: { q: string; onFilter: (next: string) => void }) {
  const kind = operatorValue(q, "kind");
  const author = operatorValue(q, "author");
  return (
    <div className="filters">
      <fieldset className="kinds" aria-label="Kind">
        {KINDS.map(([k, label]) => (
          <button
            key={k}
            aria-pressed={kind === k}
            onClick={() => onFilter(setOperator(q, "kind", k))}
          >
            {label}
          </button>
        ))}
      </fieldset>
      <fieldset className="kinds" aria-label="Author">
        {AUTHORS.map(([a, label]) => (
          <button
            key={a}
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
