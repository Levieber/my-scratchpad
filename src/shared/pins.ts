/**
 * How many notes the home page keeps above the list: enough for a week's worth of what matters,
 * few enough that the list (one line per pin, components/notes/note-row.tsx) leaves the latest
 * notes on a phone's first screen, which test/e2e/busy.test.ts checks. Here rather than in
 * domain.ts so the PWA can read it without loading Effect.
 */
export const MAX_PINS = 8;
