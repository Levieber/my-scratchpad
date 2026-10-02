import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { inflateSync } from "node:zlib";

import { type TestServer, testServer } from "@test/support";

let server: TestServer;
beforeAll(async () => {
  server = await testServer();
});
afterAll(() => server.stop());

const get = (path: string) => fetch(new URL(path, server.url));

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** What a PNG says about itself, and its first pixel (the corner), read without a decoder. */
function inspectPng(bytes: Buffer) {
  expect(bytes.subarray(0, 8).equals(PNG)).toBe(true);
  const colorType = bytes[25];
  const idat: Buffer[] = [];
  for (let at = 8; at < bytes.length;) {
    const length = bytes.readUInt32BE(at);
    if (bytes.toString("latin1", at + 4, at + 8) === "IDAT")
      idat.push(bytes.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  // The first row has nothing above or to its left, so whatever its filter, byte 1.. are the
  // first pixel as it is.
  const row = inflateSync(Buffer.concat(idat));
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    // 6 = RGBA; 2 = RGB (no alpha at all, which Chrome writes when every pixel is opaque).
    hasAlpha: colorType === 6,
    cornerAlpha: colorType === 6 ? row[4] : 255,
  };
}

const png = async (path: string) => {
  const res = await get(path);
  expect([path, res.status, res.headers.get("content-type")]).toEqual([path, 200, "image/png"]);
  return inspectPng(Buffer.from(await res.arrayBuffer()));
};

describe("PWA icons", () => {
  test("every icon the manifest names is served, at the size it declares", async () => {
    const manifest = (await (await get("/manifest.webmanifest")).json()) as {
      icons: { src: string; sizes: string; type: string; purpose: string }[];
    };
    const pngs = manifest.icons.filter((i) => i.type === "image/png");
    expect(pngs.map((i) => i.sizes).sort()).toEqual(["192x192", "512x512", "512x512"]);
    for (const { src, sizes } of pngs) {
      const { width, height } = await png(`/${src}`);
      expect(`${width}x${height}`).toBe(sizes);
    }
    expect((await get("/icon.svg")).headers.get("content-type")).toBe("image/svg+xml");
  });

  test("an icon is either `any` or `maskable`, never both: one image can't suit both", async () => {
    const manifest = (await (await get("/manifest.webmanifest")).json()) as {
      icons: { purpose: string }[];
    };
    expect(manifest.icons.map((i) => i.purpose).sort()).toEqual(["any", "any", "any", "maskable"]);
  });

  test("the `any` icons keep their rounded corners; the maskable one fills its square", async () => {
    for (const path of ["/icon-192.png", "/icon-512.png"]) {
      const { hasAlpha, cornerAlpha } = await png(path);
      expect([path, hasAlpha, cornerAlpha]).toEqual([path, true, 0]);
    }
    expect((await png("/icon-maskable-512.png")).cornerAlpha).toBe(255);
  });

  test("the home-screen icon iOS uses is 180 px and opaque (iOS paints transparency black)", async () => {
    const icon = await png("/apple-touch-icon.png");
    expect([icon.width, icon.height, icon.cornerAlpha]).toEqual([180, 180, 255]);
  });

  test("the page links that icon, so iOS finds it when the page is added to the home screen", async () => {
    const page = await (await get("/")).text();
    const href = /<link[^>]*rel="apple-touch-icon"[^>]*href="([^"]+)"/.exec(page)?.[1];
    expect(href).toBeDefined();
    // Whatever address the bundler gave it, it has to answer with the icon.
    const { width, height } = await png(new URL(href!, new URL("/", server.url)).pathname);
    expect([width, height]).toEqual([180, 180]);
  });
});
