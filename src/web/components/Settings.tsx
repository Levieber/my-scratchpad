import { XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { HookSection } from "@/shared/domain";
import { type HookName, isHookName, normalizeScope, scopeLocation } from "@/shared/hooks";
import { ApiError, api, type HookSelection, type HooksInfo } from "@/web/lib/api";
import { button, field, ghostButton, iconButton, primaryButton } from "@/web/lib/classes";
import { scopeLabel } from "@/web/lib/hooks";
import { ago } from "@/web/lib/listing";
import { cn } from "@/web/lib/utils";

type Shared = {
  online: boolean;
  /** After a change: reloads what the app knows about the hooks. */
  onChanged: () => Promise<void>;
  /** Failures the page can't word itself (offline, the token). */
  onError: (e: unknown) => void;
};

/** The person's choice, or nothing: failures that aren't the API refusing go up to the app. */
const refusal = (e: unknown, onError: (e: unknown) => void) => {
  if (e instanceof ApiError) return e.message;
  onError(e);
  return "";
};

/** The settings page. Its one section for now: which notes the agent hooks show. */
export function Settings({
  info,
  supported,
  onBack,
  ...shared
}: Shared & { info: HooksInfo | null; supported: boolean; onBack: () => void }) {
  // A page of its own: its title names it, and focus lands on its heading, so a screen reader
  // announces where the person arrived.
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const before = document.title;
    document.title = `Settings · ${before}`;
    headingRef.current?.focus();
    return () => {
      document.title = before;
    };
  }, []);

  return (
    <main className="mx-auto flex min-h-0 w-full max-w-[820px] flex-col gap-4 overflow-y-auto px-5 py-3.5 max-wide:px-4 max-wide:py-3">
      <header className="flex items-center gap-2">
        <button className={ghostButton} aria-label="Back to notes" onClick={onBack}>
          ←
        </button>
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="flex-1 text-[1.0625rem] font-bold tracking-[-0.01em] outline-none"
        >
          Settings
        </h1>
      </header>

      <section aria-labelledby="agents-heading" className="flex flex-col gap-3">
        <h2 id="agents-heading" className="font-semibold">
          Agents
        </h2>
        <p className="text-sm text-muted-foreground">
          Which notes the agent hooks put in front of Claude Code: titles when a session starts, and
          references to check edits against at the end of a turn. A choice for a repository (named
          by its git remote) or a folder adds to the one for everywhere, there only. Hand-picked
          notes come first and are never cut.
        </p>
        {!shared.online && (
          <output className="text-sm text-destructive">
            Offline: shown as last loaded. Changes need the server.
          </output>
        )}
        {!supported ? (
          <p className="text-sm">This server keeps no hook choices yet: update it.</p>
        ) : !info ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          info.hooks.map(
            (h) =>
              // A hook this app doesn't know yet (a newer server) is left to newer apps.
              isHookName(h.name) && <HookCard key={h.name} hook={h} name={h.name} {...shared} />,
          )
        )}
      </section>
    </main>
  );
}

function HookCard({
  hook,
  name,
  ...shared
}: Shared & { hook: HooksInfo["hooks"][number]; name: HookName }) {
  const everywhere = hook.selections.find((s) => !s.scope);
  const scoped = hook.selections.filter((s) => s.scope);
  return (
    <article
      aria-labelledby={`hook-${name}`}
      className="flex flex-col gap-3 rounded-card border border-border bg-card p-4 max-wide:p-3"
    >
      <div>
        <h3 id={`hook-${name}`} className="font-mono text-sm font-semibold">
          {name}
        </h3>
        <p className="text-sm text-muted-foreground">{hook.description}</p>
      </div>
      <ul className="flex flex-col gap-4">
        <SelectionRow hook={name} scope="" stored={everywhere} info={hook} {...shared} />
        {scoped.map((s) => (
          <SelectionRow
            key={s.scope}
            hook={name}
            scope={s.scope}
            stored={s}
            info={hook}
            {...shared}
          />
        ))}
      </ul>
      <AddScope hook={name} {...shared} />
    </article>
  );
}

function SelectionRow({
  hook,
  scope,
  stored,
  info,
  online,
  onChanged,
  onError,
}: Shared & {
  hook: HookName;
  scope: string;
  stored: HookSelection | undefined;
  info: HooksInfo["hooks"][number];
}) {
  const initialQuery = stored ? (stored.query ?? "") : scope ? "" : info.default.query;
  const initialLimit = String(stored?.limit ?? info.default.limit);
  const [query, setQuery] = useState(initialQuery);
  const [limit, setLimit] = useState(initialLimit);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<HookSection | null>(null);

  // What is stored changed (saved here or elsewhere): the form and the preview follow it.
  const version = stored?.updated_at ?? "default";
  useEffect(() => {
    setQuery(initialQuery);
    setLimit(initialLimit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);
  useEffect(() => {
    let live = true;
    api
      .hookNotes(hook, scopeLocation(scope))
      .then((r) => live && setShown(r.sections.find((s) => s.scope === scope) ?? null))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [hook, scope, version]);

  const act = async (change: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await change();
      await onChanged();
    } catch (e) {
      setError(refusal(e, onError));
    } finally {
      setBusy(false);
    }
  };

  const label = scopeLabel(scope);
  const dirty = query !== initialQuery || limit !== initialLimit;
  const errorId = `hook-${hook}-${scope || "everywhere"}-error`;
  const picked = new Set(shown?.include);

  return (
    <li className="flex flex-col gap-2 border-t border-border pt-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <h4 className="font-semibold wrap-anywhere">{label}</h4>
        <span className="text-xs text-muted-foreground">
          {stored ? `changed by ${stored.updated_by}, ${ago(stored.updated_at)}` : "default"}
        </span>
      </div>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void act(() =>
            api.saveHookSelection(hook, {
              scope,
              query: query.trim() || null,
              limit: Number(limit),
            }),
          );
        }}
      >
        {/* Visible "Search" leads the name; the place, hidden, tells the rows apart. */}
        <label className="flex flex-[1_1_16rem] items-center gap-1.5 text-sm text-muted-foreground">
          Search<span className="sr-only"> for {label}</span>
          <input
            className={cn(field, "min-w-0 flex-1 text-foreground")}
            aria-describedby={error ? errorId : undefined}
            aria-invalid={Boolean(error)}
            placeholder="hand-picked notes only"
            value={query}
            disabled={!online}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          Limit
          <input
            className={cn(field, "w-20")}
            type="number"
            min={1}
            max={info.max_limit}
            value={limit}
            disabled={!online}
            onChange={(e) => setLimit(e.target.value)}
          />
        </label>
        <button className={primaryButton} disabled={!online || busy || !dirty}>
          Save
        </button>
        {stored && (
          <button
            type="button"
            className={button}
            disabled={!online || busy}
            onClick={() => void act(() => api.deleteHookSelection(hook, scope))}
          >
            {scope ? "Remove" : "Reset to default"}
          </button>
        )}
      </form>
      {error && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="text-sm">
        <p className="text-xs text-muted-foreground">
          {shown?.notes.length
            ? `What agents see ${scope ? "here" : "everywhere"} (${shown.notes.length}):`
            : "No notes: this adds nothing."}
        </p>
        <ul>
          {shown?.notes.map((n) => (
            <li key={n.id} className="flex min-h-6 items-center gap-1">
              <span className="min-w-0 flex-1 truncate">{n.title}</span>
              {picked.has(n.id) && (
                <>
                  <span className="text-xs text-muted-foreground">hand-picked</span>
                  <button
                    className={cn(ghostButton, iconButton, "size-6 p-0")}
                    aria-label={`Stop hand-picking ${n.title}`}
                    disabled={!online || busy}
                    onClick={() => void act(() => api.unpickHookNote(hook, n.id, scope))}
                  >
                    <XIcon />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}

const addLabel = "flex flex-[1_1_12rem] flex-col gap-1 text-xs text-muted-foreground";

/** A choice for one more place: a repository, a folder in it, or a folder outside any. */
function AddScope({ hook, online, onChanged, onError }: Shared & { hook: HookName }) {
  const [scope, setScope] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const errorId = `hook-${hook}-add-error`;

  return (
    <form
      className="flex flex-wrap items-end gap-2 border-t border-border pt-3"
      aria-label={`Choose notes for a repository or folder (${hook})`}
      onSubmit={async (e) => {
        e.preventDefault();
        const normalized = normalizeScope(scope);
        if (!normalized) {
          setError("Name a repository, a repository/folder, a ~/folder or an /absolute/folder.");
          return;
        }
        try {
          await api.saveHookSelection(hook, { scope: normalized, query: query.trim() || null });
          setScope("");
          setQuery("");
          setError("");
          await onChanged();
        } catch (err) {
          setError(refusal(err, onError));
        }
      }}
    >
      <label className={addLabel}>
        Repository or folder
        <input
          className={cn(field, "text-base text-foreground")}
          aria-describedby={error ? errorId : undefined}
          aria-invalid={Boolean(error)}
          placeholder="my-repo, my-repo/folder, ~/work or /absolute/folder"
          value={scope}
          disabled={!online}
          onChange={(e) => {
            setError("");
            setScope(e.target.value);
          }}
        />
      </label>
      <label className={addLabel}>
        Search
        <input
          className={cn(field, "text-base text-foreground")}
          placeholder="e.g. #my-repo"
          value={query}
          disabled={!online}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <button className={button} disabled={!online || !scope.trim()}>
        Add
      </button>
      {error && (
        <p id={errorId} role="alert" className="basis-full text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
