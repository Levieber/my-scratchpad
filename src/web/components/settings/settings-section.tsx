import type { ReactNode } from "react";

/**
 * One part of Settings: a heading, what the part is for, and why it can't be used now (offline),
 * then its controls. Named by its heading, for a screen reader's list of regions.
 */
export function SettingsSection({
  id,
  title,
  description,
  unavailable,
  children,
}: {
  id: string;
  title: string;
  description: ReactNode;
  /** Said, in the destructive color, while the section's controls can't work. */
  unavailable?: string | false;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-3">
      <h2 id={`${id}-heading`} className="font-semibold">
        {title}
      </h2>
      <p className="text-sm text-muted-foreground">{description}</p>
      {unavailable && <output className="text-sm text-destructive">{unavailable}</output>}
      {children}
    </section>
  );
}
