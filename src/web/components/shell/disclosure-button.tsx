import { Button } from "@/web/components/ui/button";
import { cn } from "@/web/lib/utils";

/**
 * A button that shows or hides something beside it (the note list, the pages under a page), its
 * state in `aria-expanded`. A ghost Button, less the background shadcn gives an expanded one,
 * which is a menu trigger's while its menu is open: here it would look held down for as long as
 * the thing is shown. The icon says the state (a chevron turned, a panel open or closed).
 */
export function DisclosureButton({
  className,
  size = "icon",
  ...props
}: React.ComponentProps<typeof Button> & { "aria-expanded": boolean }) {
  return (
    <Button
      variant="ghost"
      size={size}
      className={cn("aria-expanded:bg-transparent", className)}
      {...props}
    />
  );
}
