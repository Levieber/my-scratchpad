import { useEffect, useRef, useState } from "react";

import { field, primaryButton } from "@/web/lib/classes";

export function TokenDialog({ onSave }: { onSave: (token: string) => void }) {
  const [value, setValue] = useState("");
  // The dialog blocks the whole app, so moving focus into it is expected (unlike autoFocus on a page).
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  return (
    <div className="fixed inset-0 grid place-items-center bg-black/40 p-4">
      <form
        className="flex w-[min(360px,100%)] flex-col gap-2.5 rounded-card bg-card p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (value) onSave(value);
        }}
      >
        <p>This scratchpad requires an access token.</p>
        <input
          ref={input}
          className={field}
          type="password"
          placeholder="PAD_TOKEN"
          aria-label="Access token"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button className={primaryButton}>Save</button>
      </form>
    </div>
  );
}
