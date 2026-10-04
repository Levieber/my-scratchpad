// What the store can fail with besides a defect: outcomes a caller handles (the server maps each to
// an error response in routes.ts). SQL failures stay defects.
import * as Schema from "effect/Schema";

export class NoteNotFound extends Schema.TaggedError<NoteNotFound>()("NoteNotFound", {
  id: Schema.String,
}) {}
export class NoteExists extends Schema.TaggedError<NoteExists>()("NoteExists", {
  id: Schema.String,
}) {}
/** The note moved on from the version the caller based its write on. */
export class NoteChanged extends Schema.TaggedError<NoteChanged>()("NoteChanged", {
  id: Schema.String,
}) {}
export class RevisionNotFound extends Schema.TaggedError<RevisionNotFound>()("RevisionNotFound", {
  id: Schema.Number,
}) {}
/** The database can't be queried; `cause` is the driver's error. */
export class DatabaseUnavailable extends Schema.TaggedError<DatabaseUnavailable>()(
  "DatabaseUnavailable",
  { cause: Schema.Unknown },
) {}
export class ViewNotFound extends Schema.TaggedError<ViewNotFound>()("ViewNotFound", {
  id: Schema.String,
}) {}
export class ViewExists extends Schema.TaggedError<ViewExists>()("ViewExists", {
  name: Schema.String,
}) {}
/** Pinning one more note would go past MAX_PINS. */
export class PinLimit extends Schema.TaggedError<PinLimit>()("PinLimit", {
  max: Schema.Number,
}) {}
/** A hook selection past MAX_INCLUDE hand-picked notes, or with a limit above its hook's. */
export class HookLimit extends Schema.TaggedError<HookLimit>()("HookLimit", {
  reason: Schema.String,
}) {}
