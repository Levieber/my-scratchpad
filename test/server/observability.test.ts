import { afterEach, describe, expect, test } from "bun:test";

import { type TestServer, testServer } from "@test/support";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { requestIdOf } from "@/server/observability";

let server: TestServer | undefined;

afterEach(async () => {
  await server?.stop();
  server = undefined;
});

const get = async (path: string, headers: Record<string, string> = {}) => {
  server ??= await testServer({ token: "s3cret" });
  return fetch(new URL(path, server.url), { headers });
};

const requestLines = () => (server?.logs ?? []).filter((l) => l.message === "request");

describe("request ids", () => {
  test("the platform's id is used, then the caller's, else one is made up", () => {
    expect(requestIdOf({ "x-railway-request-id": "rw-1", "x-request-id": "mine" })).toBe("rw-1");
    expect(requestIdOf({ "x-request-id": "mine" })).toBe("mine");
    expect(requestIdOf({})).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("an id that isn't plainly an id is replaced, not logged", () => {
    for (const bad of ['a"b', "two words", "x".repeat(200), "line\nbreak"])
      expect(requestIdOf({ "x-request-id": bad })).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("every response carries the id, errors and unknown paths too", async () => {
    const ok = await get("/api/health", { "x-request-id": "abc-1" });
    expect(ok.headers.get("x-request-id")).toBe("abc-1");
    for (const path of ["/api/notes", "/api/nope"]) {
      const res = await get(path);
      expect([path, res.headers.get("x-request-id")?.length]).toEqual([path, 36]);
    }
  });
});

describe("request logs", () => {
  test("one line per request, with the id, method, path, status and duration", async () => {
    const res = await get("/api/tags", { authorization: "Bearer s3cret", "x-request-id": "r-7" });
    expect(res.status).toBe(200);
    const [line, ...others] = requestLines();
    expect(others).toEqual([]);
    expect(line?.level).toBe("INFO");
    expect(line?.annotations).toMatchObject({
      requestId: "r-7",
      method: "GET",
      path: "/api/tags",
      status: 200,
    });
    expect(typeof line?.annotations.durationMs).toBe("number");
  });

  test("neither the query string nor the token is logged", async () => {
    await get("/api/notes?q=my+private+search", { authorization: "Bearer s3cret" });
    const text = JSON.stringify(server?.logs);
    expect(text).toContain("/api/notes");
    expect(text).not.toContain("private");
    expect(text).not.toContain("s3cret");
  });

  test("a refused request is logged with its status", async () => {
    await get("/api/notes");
    expect(requestLines()[0]?.annotations).toMatchObject({ status: 401 });
  });

  test("a healthy health check stays out of the log", async () => {
    await get("/api/health");
    expect(requestLines()).toEqual([]);
  });
});

describe("health check", () => {
  test("is open, and says ok while the database answers", async () => {
    const res = await get("/api/health");
    expect([res.status, await res.json()]).toEqual([200, { ok: true }]);
  });

  test("answers 503 and logs the driver's error while the database doesn't", async () => {
    server = await testServer();
    await server.run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`DROP TABLE notes`;
      }),
    );
    const res = await get("/api/health", { "x-request-id": "h-1" });
    const body = (await res.json()) as { error: string; message: string };
    expect([res.status, body.error]).toEqual([503, "unavailable"]);
    // The body says that it failed, never why.
    expect(JSON.stringify(body)).not.toContain("notes");

    // The log has the cause chain, down to the driver's own code.
    const failure = server.logs.find(
      (l) => Array.isArray(l.message) && l.message[0] === "database unavailable",
    );
    expect(failure?.level).toBe("ERROR");
    expect(failure?.annotations).toMatchObject({ requestId: "h-1" });
    expect(JSON.stringify(failure?.message)).toContain("SQLITE_ERROR");
    expect(requestLines()[0]?.annotations).toMatchObject({ path: "/api/health", status: 503 });
  });
});
