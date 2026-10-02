// Shared test fixtures: the real server and store, built from the same layers production uses, on
// an in-memory database. Each fixture owns a ManagedRuntime, so `run` reaches its services directly.
import * as Effect from "effect/Effect";
import * as HttpServer from "effect/http/HttpServer";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Redacted from "effect/Redacted";
import * as TestClock from "effect/testing/TestClock";

import { Store } from "@/db";
import { serverLayer } from "@/server";

const runner =
  <R>(runtime: ManagedRuntime.ManagedRuntime<R, unknown>) =>
  <A, E>(effect: Effect.Effect<A, E, R>) =>
    runtime.runPromise(effect);

/** A store on a fresh database, with a clock the test moves by hand (TestClock). */
export async function testStore(start = "2026-09-29T10:00:00.000Z") {
  const runtime = ManagedRuntime.make(Store.layer(":memory:").pipe(Layer.merge(TestClock.layer())));
  const run = runner(runtime);
  await run(TestClock.setTime(Date.parse(start)));
  return {
    run,
    advance: (ms: number) => run(TestClock.adjust(ms)),
    dispose: () => runtime.dispose(),
  };
}

/** The API on a random port, on a fresh database. */
export async function testServer({ token }: { token?: string } = {}) {
  const runtime = ManagedRuntime.make(
    serverLayer({ token: token === undefined ? undefined : Redacted.make(token) }).pipe(
      Layer.provideMerge(Store.layer(":memory:")),
    ),
  );
  const run = runner(runtime);
  const url = new URL(await run(HttpServer.addressFormattedWith(Effect.succeed)));
  return { url, run, stop: () => runtime.dispose() };
}

export type TestServer = Awaited<ReturnType<typeof testServer>>;
