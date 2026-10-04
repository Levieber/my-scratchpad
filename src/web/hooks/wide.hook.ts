import { useSyncExternalStore } from "react";

// The `wide` breakpoint (index.css): where a layout that needs room, like the table, has it.
const query = matchMedia("(min-width: 721px)");

export const useWide = () =>
  useSyncExternalStore(
    (fn) => {
      query.addEventListener("change", fn);
      return () => query.removeEventListener("change", fn);
    },
    () => query.matches,
  );
