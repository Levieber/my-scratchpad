import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

import { cn } from "@/web/lib/utils";

/**
 * A card that opens one thing (a note in the grid, on a board): a surface whose CoverButton
 * stretches over it, so a click anywhere opens it and the card is still one button for the
 * keyboard and screen readers. Outlined in the brand color while it is the one open.
 */
export function ClickableCard({
  current = false,
  className,
  render,
  ...props
}: useRender.ComponentProps<"div"> & { current?: boolean }) {
  return useRender({
    defaultTagName: "div",
    render,
    props: mergeProps<"div">(
      {
        className: cn(
          "group/row relative flex flex-col rounded-lg border border-border bg-card hover:border-primary/50 data-current:border-primary",
          className,
        ),
      },
      props,
    ),
    state: { current },
  });
}

/**
 * The button naming what a card or a table row opens: its ::after covers the nearest positioned
 * ancestor (the ClickableCard, the row), and draws the focus ring there. Anything else clickable
 * inside (a NoteMenu) sits above it with `relative z-10`.
 */
export function CoverButton({ className, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "min-w-0 flex-1 text-left font-semibold wrap-anywhere after:absolute after:inset-0 after:rounded-lg focus-ring-cover",
        className,
      )}
      {...props}
    />
  );
}
