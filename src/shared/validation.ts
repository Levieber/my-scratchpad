// What to tell someone whose note didn't decode: the API's 400 and `pad import` report these.
import type * as Schema from "effect/Schema";
import type * as SchemaIssue from "effect/SchemaIssue";

// One line per field, worded for whoever reads the raw error: Schema's own messages name the
// innermost failure ("Expected string at ["tags"][0]"), which says less than the field's rule.
const FIELD_RULES: Record<string, string> = {
  id: "id must be 8-64 letters, digits, '-' or '_'",
  title: "title must be a string",
  body: "body must be a string",
  tags: "tags must be an array of strings",
};

/** The top-level field a decoding failure is about, or undefined when the value isn't an object. */
export function failedField(error: Schema.SchemaError): string | undefined {
  const find = (issue: SchemaIssue.Issue): string | undefined => {
    if (issue._tag === "Pointer") return String(issue.path[0]);
    if (issue._tag === "Composite") return find(issue.issues[0]);
    return undefined;
  };
  return find(error.issue);
}

/** A failure to decode a note input, as the sentence the API and `pad import` report. */
export const inputProblem = (error: Schema.SchemaError) => {
  const field = failedField(error);
  return (field && FIELD_RULES[field]) ?? "Expected a JSON object";
};
