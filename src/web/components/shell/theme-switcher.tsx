import { type LucideIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react";

import { Hint } from "@/web/components/shell/hint";
import { ToggleGroup, ToggleGroupItem } from "@/web/components/ui/toggle-group";
import { useStore } from "@/web/hooks/store.hook";
import { type Theme, theme, THEMES } from "@/web/lib/theme";
import { cn } from "@/web/lib/utils";

const OPTIONS: Record<Theme, { label: string; hint: string; Icon: LucideIcon }> = {
  system: { label: "System", hint: "Follow this device's setting", Icon: MonitorIcon },
  light: { label: "Light", hint: "Light", Icon: SunIcon },
  dark: { label: "Dark", hint: "Dark", Icon: MoonIcon },
};

/**
 * System, Light or Dark, for this device: a radio group of icons (one tab stop, arrow keys
 * inside), each named for screen readers and explained on hover and focus.
 */
export function ThemeSwitcher({ className }: { className?: string }) {
  const chosen = useStore(theme);
  return (
    <ToggleGroup
      aria-label="Theme"
      spacing={0}
      className={cn("flex-none", className)}
      value={[chosen]}
      onValueChange={(next) => {
        // Pressing the one already pressed releases it; some theme is always chosen.
        const picked = THEMES.find((t) => next.includes(t) && t !== chosen);
        if (picked) theme.set(picked);
      }}
    >
      {THEMES.map((t) => {
        const { label, hint, Icon } = OPTIONS[t];
        return (
          <Hint key={t} label={hint}>
            <ToggleGroupItem value={t} aria-label={label} className="h-6 min-w-6 px-1">
              <Icon className="size-3.5" />
            </ToggleGroupItem>
          </Hint>
        );
      })}
    </ToggleGroup>
  );
}
