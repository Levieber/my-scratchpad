/**
 * The daily review: one `note` per day, tagged `daily`, found by its title. The date comes from
 * the client, because "today" depends on where the person is and the server runs in UTC.
 */
export const DAILY_TAG = "daily";

export const dailyTitle = (date: string) => `Daily review ${date}`;

export function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  // Round-tripping rejects dates the regex allows but the calendar doesn't (2026-02-30).
  return new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
}

export const localDate = (d = new Date()) =>
  [d.getFullYear(), d.getMonth() + 1, d.getDate()]
    .map((n, i) => String(n).padStart(i ? 2 : 4, "0"))
    .join("-");

export function dailyBody(carried: string[]): string {
  const carriedSection = carried.length
    ? `## Carried over\n${carried.map((t) => `- [ ] ${t}`).join("\n")}\n\n`
    : "";
  return `${carriedSection}## Done\n- \n\n## Doing\n- \n\n## Blocked\n- \n\n## Tomorrow\n- [ ] \n`;
}
