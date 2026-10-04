// What the view endpoints read: a saved search's name and query, and how it is shown.
import * as Effect from "effect/Effect";

import type { NewView, ViewPatch } from "@/shared/domain";
import { isLayout, isObject, LAYOUT_KEYS } from "@/shared/layouts";

import { type Request, readJson, refuse } from "./http";

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/**
 * A view's fields from a request body: all of them to create one (`POST`, name and query
 * required), only those it changes to edit one (`PATCH`). A layout this server doesn't know is
 * refused, so a client finds out now rather than when the view comes back as the list.
 */
export const readView = <Create extends boolean>(req: Request, { create }: { create: Create }) =>
  Effect.gen(function* () {
    const body = yield* readJson(req);
    if (!isObject(body)) return yield* refuse("invalidBody", 400, "Expected an object");
    const { name, query, layout, options } = body;
    if ((create || name !== undefined) && !nonEmpty(name))
      return yield* refuse("invalidBody", 400, "name must be a non-empty string");
    if ((create || query !== undefined) && !nonEmpty(query))
      return yield* refuse("invalidBody", 400, "query must be a non-empty string");
    if (layout !== undefined && layout !== null && !isLayout(layout))
      return yield* refuse(
        "invalidLayout",
        400,
        `layout must be one of: ${LAYOUT_KEYS.join(", ")}, or null for the device's own`,
      );
    if (options !== undefined && !isObject(options))
      return yield* refuse("invalidViewOptions", 400, "options must be an object");
    const view: ViewPatch = {
      ...(nonEmpty(name) && { name: name.trim().slice(0, 64) }),
      ...(nonEmpty(query) && { query: query.trim() }),
      ...(layout !== undefined && { layout }),
      ...(options !== undefined && { options }),
    };
    return view as Create extends true ? NewView : ViewPatch;
  });
