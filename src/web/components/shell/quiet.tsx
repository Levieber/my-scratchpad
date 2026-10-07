import { Button } from "@/web/components/ui/button";
import { cn } from "@/web/lib/utils";

// A quiet link, in the app's chrome rather than a note: the footer's links, the breadcrumbs, the
// subpages and backlinks. Underlined faintly, so it reads as a link without color alone, and as
// tall as a tap target. An <a> to go somewhere, a <button> to run code (Export): one look.
const quietLink =
  "inline-block min-h-6 min-w-6 max-w-full truncate rounded-sm align-middle leading-6 text-muted-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground hover:decoration-current focus-ring";

export function QuietLink({ className, children, ...props }: React.ComponentProps<"a">) {
  return (
    <a className={cn(quietLink, className)} {...props}>
      {children}
    </a>
  );
}

export function QuietLinkButton({ className, ...props }: React.ComponentProps<"button">) {
  return <button type="button" className={cn(quietLink, className)} {...props} />;
}

/** A quiet action beside quiet links (a new subpage, a view opened as the search). */
export function QuietButton({ className, ...props }: React.ComponentProps<typeof Button>) {
  return (
    <Button
      variant="ghost"
      size="xs"
      className={cn("font-normal text-muted-foreground", className)}
      {...props}
    />
  );
}
