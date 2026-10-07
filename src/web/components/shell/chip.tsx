import { cva, type VariantProps } from "class-variance-authority";
import { ChevronDownIcon } from "lucide-react";

import { Button } from "@/web/components/ui/button";
import { ToggleGroupItem } from "@/web/components/ui/toggle-group";
import { cn } from "@/web/lib/utils";

// The chips above the list (filters, saved views, tags): one shape, one pressed look, so a row of
// them reads as one control. docs/design-system.md, "Chips".
const chipVariants = cva("rounded-full font-normal aria-pressed:border-primary", {
  variants: {
    size: {
      sm: "h-6 min-w-6 gap-1 px-2 text-xs",
      md: "h-7 min-w-7 px-3 text-caption",
    },
  },
  defaultVariants: { size: "sm" },
});

/** A chip that is pressed or not, inside a ToggleGroup (one tab stop, arrow keys between). */
export function ChipToggle({
  size,
  className,
  ...props
}: Omit<React.ComponentProps<typeof ToggleGroupItem>, "size" | "variant"> &
  VariantProps<typeof chipVariants>) {
  return (
    <ToggleGroupItem
      variant="outline"
      className={cn(chipVariants({ size }), className)}
      {...props}
    />
  );
}

/** A chip that does something rather than filters (more of a list, save the search): dashed. */
export function ChipButton({ className, ...props }: React.ComponentProps<typeof Button>) {
  return (
    <Button
      variant="outline"
      size="xs"
      className={cn(chipVariants({ size: "sm" }), "border-dashed text-muted-foreground", className)}
      {...props}
    />
  );
}

/**
 * A chip showing a setting and its value, which opens its choices (the board's columns): solid,
 * as it holds a value rather than offering an action, and the chevron says it opens.
 */
export function ChipSelect({
  label,
  className,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { label: string }) {
  return (
    <Button
      variant="outline"
      size="xs"
      className={cn(chipVariants({ size: "sm" }), "max-w-full text-muted-foreground", className)}
      {...props}
    >
      {label}
      <span className="min-w-0 truncate text-foreground">{children}</span>
      <ChevronDownIcon />
    </Button>
  );
}
