import type { ReactElement } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/web/components/ui/tooltip";

/**
 * A short explanation on hover and on keyboard focus, in place of `title`, which touch and
 * keyboard users never see. `children` is the control itself; a disabled control gets no pointer
 * events, so its hint (why it is disabled) sits on a wrapper around it.
 */
export function Hint({
  label,
  disabled = false,
  children,
}: {
  label: string;
  disabled?: boolean;
  children: ReactElement;
}) {
  return (
    <Tooltip>
      {disabled ? (
        <TooltipTrigger render={<span className="inline-flex" />}>{children}</TooltipTrigger>
      ) : (
        <TooltipTrigger render={children} />
      )}
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
