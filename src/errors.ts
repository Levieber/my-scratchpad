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
  invalidDate: "Expected a date as YYYY-MM-DD",
  unauthorized: "Missing or invalid bearer token",
  noteNotFound: "Note not found",
  notFound: "No such endpoint",
  methodNotAllowed: "Method not allowed",
  internal: "Internal error",
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
