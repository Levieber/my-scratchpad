// A note's title when none is given. Shared so a note written offline is listed under the title
// the server will give it.

/** The first non-empty line, without heading marks. */
export const deriveTitle = (body: string) =>
  (body.split("\n").find((l) => l.trim()) ?? "")
    .replace(/^#+\s*/, "")
    .trim()
    .slice(0, 80) || "Untitled";
