import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

import { ClientConfig, ServerConfig } from "@/config";

const env = (vars: Record<string, string>) =>
  ConfigProvider.fromEnvRecord({ HOME: "/home/u", ...vars });

const server = (vars: Record<string, string> = {}) =>
  Effect.runPromise(ServerConfig.parse(env({ XDG_DATA_HOME: "/data", ...vars })));

describe("server config", () => {
  test("defaults to loopback on 7777 with the database under XDG_DATA_HOME", async () => {
    const config = await server();
    expect([config.host, config.port, config.db]).toEqual([
      "127.0.0.1",
      7777,
      "/data/scratchpad/pad.db",
    ]);
    expect(Option.isNone(config.token)).toBe(true);
    expect(config.production).toBe(false);
  });

  test("a platform PORT listens on every interface; PAD_* settings win", async () => {
    expect(await server({ PORT: "8080" })).toMatchObject({ host: "0.0.0.0", port: 8080 });
    expect(await server({ PORT: "8080", PAD_PORT: "9000", PAD_HOST: "::1" })).toMatchObject({
      host: "::1",
      port: 9000,
    });
  });

  test("a malformed port fails instead of falling back", async () => {
    const exit = await Effect.runPromiseExit(ServerConfig.parse(env({ PAD_PORT: "abc" })));
    expect(Exit.isFailure(exit)).toBe(true);
  });

  test("the token is redacted, and an empty one is no token", async () => {
    const { token } = await server({ PAD_TOKEN: "s3cret" });
    expect(Option.map(token, Redacted.value)).toEqual(Option.some("s3cret"));
    expect(Bun.inspect({ token })).not.toContain("s3cret");
    expect(Option.isNone((await server({ PAD_TOKEN: "" })).token)).toBe(true);
  });
});

describe("client config", () => {
  const load = (vars: Record<string, string>) =>
    Effect.runPromise(
      Effect.gen(function* () {
        return yield* ClientConfig;
      }).pipe(Effect.provide(ClientConfig.layer), Effect.provide(ConfigProvider.layer(env(vars)))),
    );

  test("pad login's file is used unless the environment says otherwise", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pad-config-"));
    try {
      mkdirSync(join(dir, "scratchpad"));
      writeFileSync(
        join(dir, "scratchpad", "config.json"),
        JSON.stringify({ url: "https://pad.example/", token: "from-file" }),
      );
      const fromFile = await load({ XDG_CONFIG_HOME: dir });
      expect(fromFile.url).toBe("https://pad.example");
      expect(Option.map(fromFile.token, Redacted.value)).toEqual(Option.some("from-file"));

      const fromEnv = await load({ XDG_CONFIG_HOME: dir, PAD_URL: "http://x:1", PAD_TOKEN: "t" });
      expect(fromEnv.url).toBe("http://x:1");
      expect(Option.map(fromEnv.token, Redacted.value)).toEqual(Option.some("t"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("without a login, the local server on the configured port", async () => {
    const config = await load({ XDG_CONFIG_HOME: "/nonexistent", PAD_PORT: "7000" });
    expect(config.url).toBe("http://127.0.0.1:7000");
    expect(Option.isNone(config.token)).toBe(true);
  });
});
