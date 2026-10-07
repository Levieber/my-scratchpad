import { useState } from "react";

import { ChipButton } from "@/web/components/shell/chip";
import { FormField } from "@/web/components/shell/form-field";
import { Button } from "@/web/components/ui/button";
import { Input } from "@/web/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/web/components/ui/popover";
import { usePickedFor } from "@/web/hooks/layout.hook";
import { useViewMutations } from "@/web/hooks/views.hook";

/**
 * Names the search in force. A name already taken is the one failure the person can fix, so the
 * popover stays open and says so.
 */
export function NameView() {
  const { save } = useViewMutations();
  const how = usePickedFor();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [taken, setTaken] = useState(false);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setName("");
        setTaken(false);
      }}
    >
      <PopoverTrigger render={<ChipButton />}>Save this search</PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        <form
          className="flex flex-col gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim()) return;
            const result = await save(name.trim(), how);
            if (result === "saved") setOpen(false);
            else if (result === "taken") setTaken(true);
          }}
        >
          <FormField
            label="View name"
            error={taken ? "A view with this name already exists" : undefined}
          >
            <Input
              placeholder="Name this view"
              value={name}
              onChange={(e) => {
                setTaken(false);
                setName(e.target.value);
              }}
            />
          </FormField>
          <Button type="submit" size="sm" className="self-end">
            Save
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
