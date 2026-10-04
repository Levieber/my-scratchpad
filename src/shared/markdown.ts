// The markdown a note body is written in, stated once for the API's documents (openapi.ts,
// llms.ts) and the PWA. The body is stored and returned byte for byte; this says how it is read.
//
// New syntax is additive only: each pad extension gets the next dialect version, reads as plain
// text wherever it isn't understood, and changing what existing syntax means is a breaking change.

/** Pad's own syntax beyond CommonMark and GFM, oldest first. Empty: none yet. */
export const PAD_EXTENSIONS: readonly { since: number; syntax: string; meaning: string }[] = [];

export const DIALECT_VERSION = 1;

export const DIALECT = [
  `Markdown, dialect v${DIALECT_VERSION}: CommonMark, plus GFM task lists (\`- [ ]\`, \`- [x]\`), tables, strikethrough and autolinks.`,
  PAD_EXTENSIONS.length
    ? `Pad extensions: ${PAD_EXTENSIONS.map((e) => `\`${e.syntax}\` (${e.meaning}, v${e.since})`).join("; ")}.`
    : "No pad extensions yet.",
  "Raw HTML is shown as text, never rendered.",
  "Bodies are stored and returned byte for byte; nothing rewrites them on save.",
].join(" ");
