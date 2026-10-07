import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

import { cn } from "@/web/lib/utils";

/**
 * A row in a list to pick from (a note in the list, a page in the tree, a revision in History):
 * flat until hovered, a card's surface while it is the one open (`data-current`). `render` makes
 * it the element its list needs, an <li> or a <button>. A NoteMenu inside shows on its hover.
 */
export function Row({
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
          "group/row rounded-lg border border-transparent hover:bg-card data-current:border-border data-current:bg-card",
          className,
        ),
      },
      props,
    ),
    state: { current },
  });
}
