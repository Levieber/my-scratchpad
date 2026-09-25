/**
 * What a note is for, which decides how people and agents use it. Deliberately few: a use case
 * (launch checklist, daily review) is a tag, not a kind.
 */
export const KINDS = {
  note: "Anything used once or finished: to-dos, learnings, logs, daily reviews. The default.",
  reference:
    "Reusable rules to check work against, never done: best practices, principles, checklists.",
} as const;

export type Kind = keyof typeof KINDS;

export const KIND_NAMES = Object.keys(KINDS) as Kind[];

export const isKind = (value: unknown): value is Kind =>
  typeof value === "string" && Object.hasOwn(KINDS, value);
