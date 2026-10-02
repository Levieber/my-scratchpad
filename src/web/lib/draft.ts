// What the editor form holds while a note is being written, and how it maps to a note's fields.
import type { Kind } from "@/shared/kinds";
import type { Fields } from "@/web/lib/sync";

export type Draft = { title: string; body: string; tags: string; kind: Kind };

export const emptyDraft: Draft = { title: "", body: "", tags: "", kind: "note" };

export const toDraft = (n: Fields): Draft => ({
  title: n.title,
  body: n.body,
  tags: n.tags.join(", "),
  kind: n.kind,
});

export const fromDraft = (d: Draft): Fields => ({
  title: d.title,
  body: d.body,
  tags: d.tags
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean),
  kind: d.kind,
});

export type SaveState =
  | ""
  | "pending"
  | "saving"
  | "saved"
  | "local"
  | "merged"
  | "conflict"
  | "error";

/** What the footer says about the open note's save; `error` carries the reason. */
export const saveLabel = (state: SaveState, error: string) =>
  ({
    "": "",
    pending: "…",
    saving: "saving…",
    saved: "saved",
    local: "saved on this device · syncs when online",
    merged: "merged with changes made elsewhere",
    conflict: "edited elsewhere too: both versions kept between <<<<<<< and >>>>>>>",
    error: `not saved: ${error}`,
  })[state];
