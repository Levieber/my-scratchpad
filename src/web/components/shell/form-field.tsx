import { Field } from "@base-ui/react/field";
import type { ReactNode } from "react";

import { cn } from "@/web/lib/utils";

/**
 * A labelled field in the app's one look: Base UI's Field, which ties the label, the control and
 * the error together (aria-invalid, aria-describedby). `children` is the control, an Input.
 * Stacked; `inline` puts the label before it, for a row of settings.
 */
export function FormField({
  label,
  error,
  inline = false,
  className,
  children,
}: {
  label: ReactNode;
  /** Shown under the control, which is marked invalid while there is one. */
  error?: string;
  inline?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Field.Root
      invalid={Boolean(error)}
      className={cn(
        inline ? "flex flex-wrap items-center gap-x-1.5 gap-y-1" : "flex flex-col gap-1.5",
        className,
      )}
    >
      <Field.Label className="text-xs font-medium text-muted-foreground">{label}</Field.Label>
      {children}
      {error && (
        <Field.Error match className="basis-full text-xs text-destructive">
          {error}
        </Field.Error>
      )}
    </Field.Root>
  );
}
