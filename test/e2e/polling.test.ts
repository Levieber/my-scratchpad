// What an open tab costs while nothing changes: the polled collections are revalidated by the
// browser's own HTTP cache, so each poll is a 304 with no body, and a change still shows at once.
// The server's request log is what is counted: what it answered, not what the page was told.
import { expect, test } from "bun:test";

import { describeE2E, eventually, poll, row, useApp } from "@test/e2e/support";

const POLLED = ["/api/notes", "/api/tags", "/api/views", "/api/pins"];

describeE2E("polling an idle tab", () => {
  const app = useApp();

  /** How the server answered each polled path, from `since` (a count of log lines) on. */
  const answers = (since: number) => {
    const out: Record<string, number[]> = {};
    for (const { annotations } of app.server.logs.slice(since)) {
      const { path, status } = annotations as { path?: string; status?: number };
      if (path && POLLED.includes(path) && status) (out[path] ??= []).push(status);
    }
    return out;
  };

  /** Polls once and waits until the server has answered all four collections. */
  const pollOnce = async (page: Parameters<typeof poll>[0], since: number) => {
    await poll(page);
    await eventually(() => expect(Object.keys(answers(since)).sort()).toEqual([...POLLED].sort()));
  };

  test("after the first answer, every poll of the collections is a 304", async () => {
    await app.api.create({ body: "alpha", tags: ["one"] });
    const page = await app.open();
    await row(page, "alpha").waitFor();

    const since = app.server.logs.length;
    for (let i = 0; i < 3; i++) await pollOnce(page, since);

    const statuses = Object.values(answers(since)).flat();
    expect(new Set(statuses)).toEqual(new Set([304]));
    // The 304 hands the page its cached body: the list is still on screen.
    expect(await row(page, "alpha").count()).toBe(1);
  });

  test("a note an agent writes shows up on the next poll, and the polls after it are 304 again", async () => {
    const page = await app.open();
    await app.api.create({ body: "from an agent" });
    await poll(page);
    await row(page, "from an agent").waitFor();

    const since = app.server.logs.length;
    await pollOnce(page, since);
    expect(new Set(Object.values(answers(since)).flat())).toEqual(new Set([304]));
  });
});
