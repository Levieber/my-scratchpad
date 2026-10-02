/**
 * How many notes the home page keeps above the list. Few on purpose: pins are for what matters
 * this week, and a long pinned list stops being looked at. Here rather than in domain.ts so the
 * PWA can read it without loading Effect.
 */
export const MAX_PINS = 3;
