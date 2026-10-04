import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ROOT } from "@test/support";
import * as Cause from "effect/Cause";
import * as Exit from "effect/Exit";

import { teardown } from "@/server/serve";

const dir = mkdtempSync(join(tmpdir(), "pad-shutdown-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const exitCodeOf = (exit: Exit.Exit<unknown, unknown>) => {
  const codes: number[] = [];
  const quiet = [spyOn(console, "log"), spyOn(console, "error")].map((spy) =>
    spy.mockImplementation(() => {}),
  );
  try {
    teardown(exit, (code) => void codes.push(code));
  } finally {
    for (const spy of quiet) spy.mockRestore();
  }
  return codes;
};

describe("exit code", () => {
  test("a signal's interrupt is a requested shutdown, not a crash", () => {
    expect(exitCodeOf(Exit.failCause(Cause.interrupt(1)))).toEqual([0]);
  });

  test("a failure of the server still exits non-zero", () => {
    expect(exitCodeOf(Exit.fail("boom"))).toEqual([1]);
    expect(exitCodeOf(Exit.die(new Error("boom")))).toEqual([1]);
    // An interrupt next to a real failure is still a failure.
    expect(
      exitCodeOf(Exit.failCause(Cause.combine(Cause.interrupt(1), Cause.fail("boom")))),
    ).toEqual([1]);
  });

  // What a redeploy does to the running service: Railway sends SIGTERM, and an on-failure restart
  // policy (Railway's, systemd's) reads a non-zero exit as a crash.
  test.each(["SIGTERM", "SIGINT"] as const)(
    "the real server exits 0 on %s",
    async (signal) => {
      // The config refuses port 0, so borrow a free one from the OS.
      const probe = Bun.serve({ port: 0, fetch: () => new Response() });
      const port = probe.port;
      await probe.stop(true);
      const proc = Bun.spawn(["bun", "src/server.ts"], {
        cwd: ROOT,
        env: {
          ...process.env,
          NODE_ENV: "production",
          PAD_PORT: String(port),
          PAD_DB: join(dir, `${signal}.db`),
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      // Wait for an answer, not for the log line: runMain installs its signal handlers just after
      // the server starts, and a signal before that kills the process the way no handler would.
      const deadline = Date.now() + 10_000;
      while (
        !(await fetch(`http://127.0.0.1:${port}/`).then(
          () => true,
          () => false,
        ))
      ) {
        if (proc.exitCode !== null) throw new Error("the server exited before it answered");
        if (Date.now() > deadline) throw new Error("the server did not answer in time");
        await Bun.sleep(25);
      }
      proc.kill(signal);
      expect(await proc.exited).toBe(0);
    },
    15_000,
  );
});
