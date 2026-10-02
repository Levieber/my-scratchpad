import { useEffect, useRef, useState } from "react";

export function TokenDialog({ onSave }: { onSave: (token: string) => void }) {
  const [value, setValue] = useState("");
  // The dialog blocks the whole app, so moving focus into it is expected (unlike autoFocus on a page).
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  return (
    <div className="overlay">
      <form
        className="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (value) onSave(value);
        }}
      >
        <p>This scratchpad requires an access token.</p>
        <input
          ref={input}
          type="password"
          placeholder="PAD_TOKEN"
          aria-label="Access token"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button className="primary">Save</button>
      </form>
    </div>
  );
}
