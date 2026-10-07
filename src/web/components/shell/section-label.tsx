import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

import { cn } from "@/web/lib/utils";

/** The label over a part of a list (Pinned, Today, a board's column): small, uppercase, muted. */
export function SectionLabel({ className, render, ...props }: useRender.ComponentProps<"h2">) {
  return useRender({
    defaultTagName: "h2",
    render,
    props: mergeProps<"h2">(
      {
        className: cn(
          "text-label font-semibold tracking-wider text-muted-foreground uppercase",
          className,
        ),
      },
      props,
    ),
  });
}
