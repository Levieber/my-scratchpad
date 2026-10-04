// Syntax highlighting for fenced code in the Read view: TanStack Highlight (pinned), with only the
// languages notes use, so it stays small and loads with the Markdown chunk. Its output is the
// code escaped, with token spans (`th-token th-keyword`…) around parts of it; any other language,
// or none, is the code escaped. The palette for those spans is on the `pre` (markdown-elements.tsx).
import { createHighlighter } from "@tanstack/highlight/core";
import { json } from "@tanstack/highlight/languages/json";
import { plaintext } from "@tanstack/highlight/languages/plaintext";
// Also `sh`, `bash` and `zsh`.
import { shell } from "@tanstack/highlight/languages/shell";
import { toml } from "@tanstack/highlight/languages/toml";
import { ts } from "@tanstack/highlight/languages/ts";
import { createTanStackMarkdownHighlighter } from "@tanstack/highlight/markdown";

export const highlight = createTanStackMarkdownHighlighter(
  createHighlighter({ languages: [plaintext, ts, shell, json, toml] }),
);
