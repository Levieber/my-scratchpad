// The PWA files that must live at the site root. The app itself is bundled by Bun from the HTML
// import, which serve.ts hands to the server.
//
// Imported as files rather than read from public/ at run time, so `pad` compiled into one
// executable carries them too.
import icon from "@public/icon.svg" with { type: "file" };
import manifest from "@public/manifest.webmanifest" with { type: "file" };
import serviceWorker from "@public/sw.js" with { type: "file" };
import * as HttpRouter from "effect/http/HttpRouter";

import { staticFile } from "./http";

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
  HttpRouter.route("GET", "/icon.svg", staticFile(icon, "image/svg+xml")),
];
