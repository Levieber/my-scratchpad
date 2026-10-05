// The flags and arguments several commands share.
import * as Argument from "effect/cli/Argument";
import * as Flag from "effect/cli/Flag";

import { KIND_NAMES } from "@/shared/kinds";

export const json = Flag.Boolean("json").pipe(
  Flag.withDescription("Machine-readable output"),
  Flag.withDefault(false),
);
export const tag = Flag.String("tag").pipe(Flag.atLeast(0), Flag.withDescription("Repeatable"));
export const kind = Flag.Literals("kind", KIND_NAMES).pipe(Flag.optional);
export const author = Flag.String("author").pipe(
  Flag.withDescription("human, agent, or an author's name"),
  Flag.optional,
);
export const limit = Flag.Int("limit").pipe(Flag.withAlias("n"), Flag.optional);
export const title = Flag.String("title").pipe(Flag.withAlias("t"), Flag.optional);
/** The page a note goes under, or (`none`) the top. */
export const parent = Flag.String("parent").pipe(
  Flag.withDescription("A page's id to put it under, or none for the top"),
  Flag.optional,
);
export const id = Argument.String("id");
export const words = (name: string) => Argument.String(name).pipe(Argument.variadic());
