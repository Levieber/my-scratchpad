import { ArrowLeftIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { isHookName } from "@/shared/hooks";
import { DataSection } from "@/web/components/settings/data-section";
import { HookCard } from "@/web/components/settings/hook-card";
import { Button } from "@/web/components/ui/button";
import { useHooksInfo } from "@/web/hooks/hooks-info.hook";
import { useOnline } from "@/web/hooks/online.hook";
import { go } from "@/web/hooks/page.hook";

/** The settings page: which notes the agent hooks show, and taking the notes out or in. */
export function Settings() {
  const { info, supported } = useHooksInfo();
  const online = useOnline();
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
    <main className="mx-auto flex min-h-0 w-full max-w-205 flex-col gap-4 overflow-y-auto px-5 py-3.5 max-wide:px-4 max-wide:py-3">
      <header className="flex items-center gap-2">
        <Button variant="ghost" size="icon" aria-label="Back to notes" onClick={() => go("notes")}>
          <ArrowLeftIcon />
        </Button>
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
        {!online && (
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
              isHookName(h.name) && <HookCard key={h.name} hook={h} name={h.name} />,
          )
        )}
      </section>

      <DataSection />
    </main>
  );
}
