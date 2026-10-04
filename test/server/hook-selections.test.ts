import { afterEach, describe, expect, test } from "bun:test";

import { type TestServer, testServer } from "@test/support";

import type { Note } from "@/shared/domain";

let server: TestServer | undefined;

afterEach(async () => {
  await server?.stop();
  server = undefined;
});

async function call(method: string, path: string, body?: unknown, author = "human") {
  server ??= await testServer();
  const headers: Record<string, string> = { "x-pad-author": author };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(new URL(path, server.url), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

type Section = {
  scope: string;
  query: string | null;
  source: string;
  limit: number;
  include: string[];
  notes: Note[];
};

// Searches list the newest first; notes made in the same millisecond would tie.
const note = async (body: string, extra: object = {}) => {
  await Bun.sleep(2);
  return (await call("POST", "/api/notes", { body, ...extra })).data as Note;
};

const sections = async (hook: string, params = "") => {
  const res = await call("GET", `/api/hooks/${hook}/notes${params ? "?" + params : ""}`);
  expect(res.status).toBe(200);
  return res.data.sections as Section[];
};

// Each section as its scope and the bodies of its notes, which is what an agent ends up reading.
const shown = async (hook: string, params = "") =>
  (await sections(hook, params)).map((s) => [s.scope, s.notes.map((n) => n.body)]);

describe("hook selections", () => {
  test("with nothing chosen, each hook lists its default search", async () => {
    await note("groceries");
    await note("seo rules", { kind: "reference" });

    const listed = await call("GET", "/api/hooks");
    expect(listed.status).toBe(200);
    expect(listed.data.max_include).toBe(20);
    expect(listed.data.hooks).toEqual([
      expect.objectContaining({
        name: "session-start",
        default: { query: "kind:note", limit: 8 },
        max_limit: 30,
        selections: [],
      }),
      expect.objectContaining({
        name: "review",
        default: { query: "kind:reference", limit: 100 },
        selections: [],
      }),
    ]);

    expect(await sections("session-start")).toEqual([
      expect.objectContaining({ scope: "", query: "kind:note", source: "default", limit: 8 }),
    ]);
    expect(await shown("session-start")).toEqual([["", ["groceries"]]]);
    expect(await shown("review")).toEqual([["", ["seo rules"]]]);
  });

  test("the user's choice replaces the default everywhere, and says who made it", async () => {
    await note("groceries");
    await note("ship it", { tags: ["now"] });

    const saved = await call("PUT", "/api/hooks/session-start", { query: "#now" }, "claude-code");
    expect(saved.status).toBe(200);
    expect(saved.data).toMatchObject({
      hook: "session-start",
      scope: "",
      query: "#now",
      include: [],
      limit: 8,
      updated_by: "claude-code",
    });
    expect((await sections("session-start"))[0]).toMatchObject({ source: "user", query: "#now" });
    expect(await shown("session-start")).toEqual([["", ["ship it"]]]);
  });

  test("a repository's selection adds to the one for everywhere, most specific first", async () => {
    await note("groceries");
    await note("pad roadmap", { tags: ["pad"] });
    await note("pad web notes", { tags: ["pad", "web"] });

    // Stored in one spelling: the repository's name without case.
    const saved = await call("PUT", "/api/hooks/session-start", {
      scope: "My-Scratchpad",
      query: "#pad",
    });
    expect(saved.data.scope).toBe("my-scratchpad");
    await call("PUT", "/api/hooks/session-start", {
      scope: "my-scratchpad/apps/web",
      query: "#web",
    });

    expect(await shown("session-start", "repo=my-scratchpad&path=apps/web/src")).toEqual([
      ["my-scratchpad/apps/web", ["pad web notes"]],
      // Already shown above, so not repeated.
      ["my-scratchpad", ["pad roadmap"]],
      ["", ["groceries"]],
    ]);
    expect(await shown("session-start", "repo=my-scratchpad&path=docs")).toEqual([
      ["my-scratchpad", ["pad web notes", "pad roadmap"]],
      ["", ["groceries"]],
    ]);
    // Elsewhere, only the choice for everywhere applies.
    expect(await shown("session-start", "repo=upbet")).toEqual([
      ["", ["pad web notes", "pad roadmap", "groceries"]],
    ]);
  });

  test("a folder outside any repository is a scope too", async () => {
    await note("journal habits", { tags: ["journal"] });
    await call("PUT", "/api/hooks/session-start", {
      scope: "/home/me/journal/",
      query: "#journal",
    });
    expect(
      (await sections("session-start", "dir=/home/me/journal/2026")).map((s) => s.scope),
    ).toEqual(["/home/me/journal", ""]);
  });

  test("a folder of projects applies to every project in it, after the project's own choice", async () => {
    await note("work hours", { tags: ["work"] });
    await note("app deploy steps", { tags: ["app"] });
    await call("PUT", "/api/hooks/session-start", { scope: "/home/me/work", query: "#work" });
    await call("PUT", "/api/hooks/session-start", { scope: "my-app", query: "#app" });

    const inApp = "repo=my-app&path=src&dir=/home/me/work/my-app/src";
    expect((await shown("session-start", inApp)).slice(0, 2)).toEqual([
      ["my-app", ["app deploy steps"]],
      ["/home/me/work", ["work hours"]],
    ]);
    // Any other project under the folder, in a repository or not, gets the folder's notes.
    expect(
      (await sections("session-start", "dir=/home/me/work/scripts/2026")).map((s) => s.scope),
    ).toEqual(["/home/me/work", ""]);
  });

  test("hand-picked notes come first, aren't cut by the limit, and vanish with their note", async () => {
    const old = await note("old checklist", { kind: "reference" });
    const extra = await note("extra rules", { kind: "reference" });
    for (const body of ["one", "two", "three"]) await note(body);

    expect((await call("PUT", `/api/hooks/session-start/include/${old.id}`)).status).toBe(204);
    // Picking it again changes nothing.
    expect((await call("PUT", `/api/hooks/session-start/include/${old.id}`)).status).toBe(204);
    await call("PUT", `/api/hooks/session-start/include/${extra.id}`);
    await call("PUT", "/api/hooks/session-start", { limit: 3 });

    const [everywhere] = await sections("session-start");
    expect(everywhere!.include).toEqual([old.id, extra.id]);
    // The two picked notes, then the search fills what's left of the limit.
    expect(everywhere!.notes.map((n) => n.body)).toEqual(["old checklist", "extra rules", "three"]);

    await call("DELETE", `/api/notes/${old.id}`);
    expect((await shown("session-start"))[0]![1]).toEqual(["extra rules", "three", "two"]);
    // The next write drops the deleted note from the stored list too.
    await call("PUT", "/api/hooks/session-start", { limit: 3 });
    expect((await call("GET", "/api/hooks")).data.hooks[0].selections[0].include).toEqual([
      extra.id,
    ]);

    expect((await call("DELETE", `/api/hooks/session-start/include/${extra.id}`)).status).toBe(204);
    expect((await call("DELETE", `/api/hooks/session-start/include/${extra.id}`)).status).toBe(204);
    expect((await shown("session-start"))[0]![1]).toEqual(["three", "two", "one"]);
  });

  test("a repository's selection can be hand-picked notes alone", async () => {
    const picked = await note("pad conventions", { kind: "reference" });
    await note("unrelated");
    expect(
      (await call("PUT", `/api/hooks/session-start/include/${picked.id}?scope=my-scratchpad`))
        .status,
    ).toBe(204);
    const [repo] = await sections("session-start", "repo=my-scratchpad");
    expect(repo).toMatchObject({ scope: "my-scratchpad", query: null });
    expect(repo!.notes.map((n) => n.body)).toEqual(["pad conventions"]);
  });

  test("this machine's override replaces the search for everywhere", async () => {
    await note("groceries");
    await note("ship it", { tags: ["now"] });
    await call("PUT", "/api/hooks/session-start", { query: "kind:note" });
    expect(await sections("session-start", "query=%23now")).toEqual([
      expect.objectContaining({ scope: "", source: "machine", query: "#now" }),
    ]);
    expect(await shown("session-start", "query=%23now")).toEqual([["", ["ship it"]]]);
  });

  test("deleting a selection goes back to the default, and deleting none is fine", async () => {
    await call("PUT", "/api/hooks/review", { query: "#seo" });
    await call("PUT", "/api/hooks/review", { scope: "pad", query: "#pad" });
    expect((await call("DELETE", "/api/hooks/review")).status).toBe(204);
    expect((await call("DELETE", "/api/hooks/review")).status).toBe(204);
    expect((await sections("review"))[0]).toMatchObject({ source: "default" });
    expect((await call("DELETE", "/api/hooks/review?scope=pad")).status).toBe(204);
    expect((await call("GET", "/api/hooks")).data.hooks[1].selections).toEqual([]);
  });

  test("refuses what can't be a selection", async () => {
    const picked = (await note("x")).id;
    const many = [];
    for (let i = 0; i < 21; i++) many.push((await note(`n${i}`)).id);

    const cases: [string, string, unknown, number, string][] = [
      ["GET", "/api/hooks/pre-compact/notes", undefined, 404, "unknownHook"],
      ["PUT", "/api/hooks/pre-compact", { query: "x" }, 404, "unknownHook"],
      ["DELETE", "/api/hooks/toString", undefined, 404, "unknownHook"],
      ["PUT", `/api/hooks/pre-compact/include/${picked}`, undefined, 404, "unknownHook"],
      ["PUT", "/api/hooks/review", { scope: "pad/../x", query: "x" }, 400, "invalidScope"],
      ["DELETE", "/api/hooks/review?scope=/", undefined, 400, "invalidScope"],
      ["PUT", "/api/hooks/review", { query: 3 }, 400, "invalidBody"],
      ["PUT", "/api/hooks/review", { include: "x" }, 400, "invalidBody"],
      ["PUT", "/api/hooks/review", { limit: 0 }, 400, "invalidBody"],
      ["PUT", "/api/hooks/review", { limit: 201 }, 409, "hookLimit"],
      ["PUT", "/api/hooks/review", { include: many }, 409, "hookLimit"],
      ["PUT", "/api/hooks/review", { include: ["nope1234"] }, 404, "noteNotFound"],
      ["PUT", "/api/hooks/review/include/nope1234", undefined, 404, "noteNotFound"],
    ];
    for (const [method, path, body, status, code] of cases) {
      const res = await call(method, path, body);
      expect([method, path, res.status, res.data?.error]).toEqual([method, path, status, code]);
    }
  });

  test("the contract documents every hook endpoint and error", async () => {
    const doc = (await call("GET", "/openapi.json")).data;
    expect(Object.keys(doc.paths).filter((p) => p.startsWith("/api/hooks"))).toEqual([
      "/api/hooks",
      "/api/hooks/{name}",
      "/api/hooks/{name}/notes",
      "/api/hooks/{name}/include/{id}",
    ]);
    expect(doc.components.schemas.Error.properties.error.enum).toEqual(
      expect.arrayContaining(["unknownHook", "invalidScope", "hookLimit"]),
    );
  });
});
