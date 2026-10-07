import { ArrowLeftIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { isHookName } from "@/shared/hooks";
import { DataSection } from "@/web/components/settings/data-section";
import { HookCard } from "@/web/components/settings/hook-card";
import { SettingsSection } from "@/web/components/settings/settings-section";
import { Hint } from "@/web/components/shell/hint";
import { ThemeSwitcher } from "@/web/components/shell/theme-switcher";
import { Button } from "@/web/components/ui/button";
import { useHooksInfo } from "@/web/hooks/hooks-info.hook";
import { useOnline } from "@/web/hooks/online.hook";
import { go } from "@/web/hooks/route.hook";

/**
 * The settings page: which notes the agent hooks show, this device's theme, and taking the notes
 * out or in.
 */
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
    // One scroll area, the page's column, its scrollbar at the column's edge as the list's is.
    <main className="flex scroll-column flex-col gap-4 py-3.5 [--column:820px] [--gutter:1.25rem] max-wide:py-3 max-wide:[--gutter:1rem]">
      <header className="flex items-center gap-2">
        <Hint label="Back to notes">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Back to notes"
            onClick={() => go("notes")}
          >
            <ArrowLeftIcon />
          </Button>
        </Hint>
        <h1 ref={headingRef} tabIndex={-1} className="flex-1 text-title font-bold outline-none">
          Settings
        </h1>
      </header>

      <SettingsSection
        id="appearance"
        title="Appearance"
        description="Theme on this device: its own setting, or always light or dark."
      >
        <ThemeSwitcher className="self-start" />
      </SettingsSection>

      <DataSection />

      <SettingsSection
        id="agents"
        title="Agents"
        description="Which notes the agent hooks put in front of Claude Code: titles when a session starts, and references to check edits against at the end of a turn. A choice for a repository (named by its git remote) or a folder adds to the one for everywhere, there only. Hand-picked notes come first and are never cut."
        unavailable={!online && "Offline: shown as last loaded. Changes need the server."}
      >
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
      </SettingsSection>
    </main>
  );
}
