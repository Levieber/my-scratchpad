#!/usr/bin/env bun
// Renders the PNG icons from the SVG sources in public/ with headless Chrome (`bun run
// build:icons`). The PNGs are committed: this only needs running when an SVG changes.
//
// Why PNGs at all: iOS ignores SVG for the home-screen icon (it wants `apple-touch-icon` as a
// PNG), and Android's installer wants PNGs at 192 and 512 px.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PUBLIC = join(import.meta.dir, "..", "public");

// `any` icons keep the rounded corners of icon.svg on a transparent background. The others are
// full-bleed (icon-maskable.svg): a maskable icon is cropped to a shape by the OS, and iOS rounds
// the corners itself and paints transparency black, so neither may bring its own.
const ICONS = [
  { source: "icon.svg", file: "icon-192.png", size: 192 },
  { source: "icon.svg", file: "icon-512.png", size: 512 },
  { source: "icon-maskable.svg", file: "icon-maskable-512.png", size: 512 },
  { source: "icon-maskable.svg", file: "apple-touch-icon.png", size: 180 },
];

const CHROME = [process.env.CHROME, "google-chrome", "chromium", "chromium-browser"].filter(
  (c): c is string => Boolean(c),
);

const chrome = CHROME.find((name) => Bun.which(name));
if (!chrome) {
  console.error("No Chrome found: install one, or set CHROME to its path.");
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), "pad-icons-"));
try {
  for (const { source, file, size } of ICONS) {
    const page = join(work, "page.html");
    writeFileSync(
      page,
      `<!doctype html><body style="margin:0;background:transparent"><img src="file://${join(PUBLIC, source)}" width="${size}" height="${size}" style="display:block">`,
    );
    const run = Bun.spawnSync([
      chrome,
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--hide-scrollbars",
      `--user-data-dir=${join(work, "profile")}`,
      "--default-background-color=00000000",
      `--window-size=${size},${size}`,
      `--screenshot=${join(PUBLIC, file)}`,
      `file://${page}`,
    ]);
    if (!run.success) {
      console.error(`Rendering ${file} failed:\n${run.stderr.toString()}`);
      process.exit(1);
    }
    console.log(`${file}  ${size}x${size}  from ${source}`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
