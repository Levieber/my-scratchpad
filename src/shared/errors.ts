import { MAX_PINS } from "./pins";

/**
 * Every error the API can answer with. Responses carry the stable `error` code for programs to
 * branch on, plus an English `message` for people and agents reading raw responses. A client that
 * shows errors in another language words them from the code, never from the message.
 */
export const ERROR_MESSAGES = {
  invalidJson: "Request body is not valid JSON",
  invalidBody: "Request body has the wrong shape",
  emptyNote: "Provide a body or a title",
  emptyAppend: "Provide text to append",
  invalidKind: "Unknown kind",
  invalidParam: "A query parameter has the wrong shape",
  unauthorized: "Missing or invalid bearer token",
  noteNotFound: "Note not found",
  noteExists: "A note with this id already exists",
  noteChanged: "The note changed since the version in If-Match; fetch it and merge",
  revisionNotFound: "Revision not found",
  viewNotFound: "View not found",
  viewExists: "A view with this name already exists",
  invalidParent:
    "The parent must be an existing note, and neither the note itself nor a page under it",
  invalidLayout: "Unknown layout",
  invalidViewOptions: "A view's options have the wrong shape",
  pinLimit: `At most ${MAX_PINS} notes can be pinned; unpin one first`,
  unknownHook: "No such hook",
  invalidScope:
    "A scope is empty (everywhere), a repository's name with an optional folder, a folder from ~ (~/work), or an absolute folder",
  hookLimit: "Too many hand-picked notes, or a limit above the hook's maximum",
  invalidImport: "The file is not an export archive, or a part of it has the wrong shape",
  unsupportedFormat: "The archive is from a newer version than this server reads",
  payloadTooLarge: "The import is larger than this server accepts",
  notFound: "No such endpoint",
  methodNotAllowed: "Method not allowed",
  internal: "Internal error",
  unavailable: "The database is not reachable",
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

export type ErrorBody = { error: ErrorCode; message: string };

export const ERROR_CODES = Object.keys(ERROR_MESSAGES);

/** Reads an error response of unknown shape (older servers sent only `{ error: <sentence> }`). */
export function readError(data: unknown): { code?: string; message?: string } {
  if (!data || typeof data !== "object") return {};
  return {
    code: "error" in data && typeof data.error === "string" ? data.error : undefined,
    message: "message" in data && typeof data.message === "string" ? data.message : undefined,
  };
}
