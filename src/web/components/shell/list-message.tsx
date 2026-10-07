import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

import { cn } from "@/web/lib/utils";

/**
 * What a list says in place of its items, or after them: empty ("No matches."), loading, or cut
 * short ("The 200 most recently changed…"). Spaced as a row is, so it sits where one would.
 */
export function ListMessage({ className, render, ...props }: useRender.ComponentProps<"p">) {
  return useRender({
    defaultTagName: "p",
    render,
    props: mergeProps<"p">(
      { className: cn("p-2.5 text-xs text-muted-foreground", className) },
      props,
    ),
  });
}
