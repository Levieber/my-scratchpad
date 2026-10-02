// The PWA files that must live at the site root. The app itself is bundled by Bun from the HTML
// import, which serve.ts hands to the server.
//
// Imported as files rather than read from public/ at run time, so `pad` compiled into one
// executable carries them too.
import appleTouchIcon from "@public/apple-touch-icon.png" with { type: "file" };
import icon192 from "@public/icon-192.png" with { type: "file" };
import icon512 from "@public/icon-512.png" with { type: "file" };
import iconMaskable from "@public/icon-maskable-512.png" with { type: "file" };
import icon from "@public/icon.svg" with { type: "file" };
import manifest from "@public/manifest.webmanifest" with { type: "file" };
import serviceWorker from "@public/sw.js" with { type: "file" };
import * as HttpRouter from "effect/http/HttpRouter";

import { staticFile } from "./http";

// The icons are requested by name, with no hash to cache them for good: a day, then they are
// checked again (the service worker has its own copy until its cache version changes).
const daily = { "cache-control": "public, max-age=86400" };

export const pwaRoutes = [
  HttpRouter.route(
    "GET",
    "/sw.js",
    staticFile(serviceWorker, undefined, { "cache-control": "no-cache" }),
  ),
  HttpRouter.route(
    "GET",
    "/manifest.webmanifest",
    staticFile(manifest, "application/manifest+json"),
  ),
  HttpRouter.route("GET", "/icon.svg", staticFile(icon, "image/svg+xml", daily)),
  HttpRouter.route("GET", "/icon-192.png", staticFile(icon192, "image/png", daily)),
  HttpRouter.route("GET", "/icon-512.png", staticFile(icon512, "image/png", daily)),
  HttpRouter.route("GET", "/icon-maskable-512.png", staticFile(iconMaskable, "image/png", daily)),
  // iOS asks for this path by itself when a page has no apple-touch-icon link it can use.
  HttpRouter.route("GET", "/apple-touch-icon.png", staticFile(appleTouchIcon, "image/png", daily)),
];
