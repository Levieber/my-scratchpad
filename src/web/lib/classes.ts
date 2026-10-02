// The controls the app repeats, as Tailwind class lists, so each looks the same wherever it is
// used. One-off styling stays on the element; combine with `cn` to adjust one of these.

/** A plain button: a bordered pill of text. */
export const button = "rounded-lg border border-border bg-card px-3 py-1.5";

/** The one main action on a screen. */
export const primaryButton =
  "rounded-lg border border-primary bg-primary px-3 py-1.5 font-semibold text-primary-foreground";

/** A borderless toolbar button; turns the accent color while pressed. */
export const ghostButton =
  "rounded-lg border border-transparent px-2 py-1 text-lg hover:bg-accent aria-pressed:text-primary";

/** A ghost button that holds only an icon, sized like the text beside it. */
export const iconButton = "inline-grid place-items-center [&_svg]:size-[1.125rem]";

/** A filter chip: muted until pressed. Its shape is up to the row it sits in. */
export const chip =
  "border border-border bg-card text-muted-foreground aria-pressed:border-primary aria-pressed:bg-accent aria-pressed:text-foreground";

/** A secondary action among chips: "+3 more", "Save this search". */
export const moreButton =
  "rounded-lg border border-dashed border-border bg-card px-2 py-0.5 text-xs text-muted-foreground";

/** A text field. Its font size comes from the base rule that keeps fields at 1rem (index.css). */
export const field =
  "min-w-0 rounded-lg border border-border bg-card px-2.5 py-2 outline-none focus:border-primary";

/** A small rounded label beside a note's details. */
export const badge =
  "ml-1.5 rounded-full bg-accent px-1.5 text-[0.6875rem] font-medium text-primary";

/** A badge that only names something (a kind, the current revision): outlined, muted. */
export const outlineBadge =
  "ml-1.5 rounded-full border border-border px-1.5 text-[0.6875rem] font-medium text-muted-foreground";

/** A footer line: muted small text, its two ends apart. */
export const footer = "flex justify-between gap-2 text-xs text-muted-foreground";
