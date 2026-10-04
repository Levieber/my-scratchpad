import { Field } from "@base-ui/react/field";
import { useState } from "react";

import { Button } from "@/web/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/web/components/ui/dialog";
import { Input } from "@/web/components/ui/input";
import { useStore } from "@/web/hooks/store.hook";
import { needsToken } from "@/web/lib/failures";
import { provideToken } from "@/web/lib/session";

/**
 * Asks for the access token when the server refuses the one this browser has (or has none).
 * Nothing works without it, so it can't be dismissed: no close button, no Escape, no click
 * outside. Focus starts in the field (Base UI's initial focus) and stays in the dialog.
 */
export function TokenDialog() {
  const open = useStore(needsToken);
  const [value, setValue] = useState("");
  return (
    <Dialog open={open} disablePointerDismissal onOpenChange={() => {}}>
      <DialogContent showCloseButton={false} className="sm:max-w-sm">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (value) provideToken(value);
          }}
        >
          <DialogHeader>
            <DialogTitle>Access token</DialogTitle>
            <DialogDescription>This scratchpad requires an access token.</DialogDescription>
          </DialogHeader>
          <Field.Root>
            <Field.Label className="sr-only">Access token</Field.Label>
            <Input
              type="password"
              placeholder="PAD_TOKEN"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </Field.Root>
          <Button type="submit">Save</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
