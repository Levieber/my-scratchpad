import { Badge } from "@/web/components/ui/badge";
import { cn } from "@/web/lib/utils";

/**
 * A badge inside a line of small text (a note's meta line, a revision's author): Badge, a size
 * down, so it sits on the line rather than raising it.
 */
export function MetaBadge({ className, variant, ...props }: React.ComponentProps<typeof Badge>) {
  return (
    <Badge
      variant={variant}
      // An outline badge labels rather than stands out (reference, current): quiet text.
      className={cn(
        "h-4 px-1.5 text-label",
        variant === "outline" && "text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
