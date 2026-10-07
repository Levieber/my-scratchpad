import type { ReactElement } from "react";

import { Kbd, KbdGroup } from "@/web/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/web/components/ui/tooltip";
import { keysOf } from "@/web/lib/keys";

/**
 * A short explanation on hover and on keyboard focus, in place of `title`, which touch and
 * keyboard users never see. `children` is the control itself; a disabled control gets no pointer
 * events, so its hint (why it is disabled) sits on a wrapper around it. `keys` is the control's
 * shortcut (`"Mod+B"`, lib/keys.ts), shown as keys after the label.
 */
export function Hint({
  label,
  keys,
  disabled = false,
  children,
}: {
  label: string;
  keys?: string;
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
      <TooltipContent>
        {label}
        {keys && (
          <KbdGroup>
            {keysOf(keys).map((k) => (
              <Kbd key={k}>{k}</Kbd>
            ))}
          </KbdGroup>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
