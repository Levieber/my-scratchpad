// The PWA's pages, with the Content-Security-Policy they are served under. Note bodies are written
// by agents and may one day be written by other people; the renderer escapes their HTML and drops
// executable links (web/components/editor/note-markdown.tsx), and this policy is the second line:
// only this site's own scripts run, and the page talks to nothing else.
//
// Bun bundles the app from the HTML import and serves it itself, ahead of the Effect router, with
// no way to add a header. So the bundle answers at an address of its own, unguessable and new on
// each start, and every page's address fetches it from there over loopback and adds the policy.
//
// Given an app built ahead of time, none of that is needed: its page is read once and served under
// the policy, and each file it names is served as it is. That is a folder built at start
// (pwa-build.ts), or the files an executable carries (scripts/builds.ts), which Bun lists itself.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { Server } from "bun";

import { PAGES } from "@/shared/pages";
import homepage from "@/web/index.html";

const POLICY = {
  "default-src": ["'self'"],
  "script-src": ["'self'"],
  // Base UI and Sonner position and inject their styles at run time.
  "style-src": ["'self'", "'unsafe-inline'"],
  // An image in a note is shown as a link to it (markdown-elements.tsx): nothing loads from an
  // address a note names.
  "img-src": ["'self'", "data:", "blob:"],
  "font-src": ["'self'", "data:"],
  "connect-src": ["'self'"],
  "manifest-src": ["'self'"],
  "worker-src": ["'self'"],
  "object-src": ["'none'"],
  "base-uri": ["'none'"],
  "form-action": ["'self'"],
  "frame-ancestors": ["'none'"],
};

// The dev server adds an inline script to the page and talks to it over a WebSocket (HMR).
const DEVELOPMENT = {
  ...POLICY,
  "script-src": ["'self'", "'unsafe-inline'"],
  "connect-src": ["'self'", "ws:", "wss:"],
};

export const contentSecurityPolicy = (development: boolean) =>
  Object.entries(development ? DEVELOPMENT : POLICY)
    .map(([directive, sources]) => `${directive} ${sources.join(" ")}`)
    .join("; ");

const HASHED = { "cache-control": "public, max-age=31536000, immutable" };

/** The app as Bun built it ahead of time, when this is an executable (`files` exists only then). */
const EMBEDDED = homepage.files ? dirname(homepage.index) : undefined;

/** Whether the PWA was bundled into this executable, so there is nothing to build at start. */
export const embeddedPwa = EMBEDDED !== undefined;

// Files as the build names them (publicPath "/"): in the page, and in its scripts, where a static
// import reads `from"/chunk-….js"` (or `import"/…"`) and a lazy one `import("/chunk-….js")`.
const IN_PAGE = /(?:src|href)="\/([^"?#/][^"?#]*)"/g;
const IN_SCRIPT = /"\/([\w.-]+\.(?:js|css))"/g;
const STATIC_IMPORT = /(?:from|import)\s*"\/([\w.-]+\.js)"/g;

const names = (text: string, pattern: RegExp) => [...text.matchAll(pattern)].map((m) => m[1]!);

/**
 * What the page names, and what its scripts name in turn, followed to the end: the chunks behind
 * its `React.lazy` boundaries (the PWA is split, scripts/builds.ts). Only those: the folder may
 * hold more (the compiled `pad` was built into it once; an executable's holds the server's own
 * code), and none of that is ours to serve. `lazy` is what the page doesn't load as it opens.
 */
function builtFiles(dir: string, html: string) {
  const read = (name: string) => {
    const path = join(dir, name);
    return name.endsWith(".js") && existsSync(path) ? readFileSync(path, "utf8") : "";
  };
  const named = names(html, IN_PAGE);
  const served = new Set(named);
  const eager = new Set(named);
  for (const name of served)
    for (const found of names(read(name), IN_SCRIPT))
      if (existsSync(join(dir, found))) served.add(found);
  for (const name of eager) for (const found of names(read(name), STATIC_IMPORT)) eager.add(found);
  return { served: [...served], lazy: [...served].filter((name) => !eager.has(name)) };
}

/**
 * The built page under the policy, and one route per file it serves. The chunks it loads only when
 * a part of it opens (Settings, History, the Read view) are named as prefetches: the browser
 * fetches them when idle without running them, so they cost no memory until used, and the service
 * worker, which caches at run time only (public/sw.js), still has them once the device is offline.
 */
function builtRoutes(dir: string, html: string, csp: string) {
  const { served, lazy } = builtFiles(dir, html);
  const prefetch = lazy.map((name) => `<link rel="prefetch" crossorigin href="/${name}">`).join("");
  const body = html.replace("</head>", `${prefetch}</head>`);
  const page = () =>
    new Response(body, {
      headers: {
        "content-type": "text/html;charset=utf-8",
        "content-security-policy": csp,
        "cache-control": "no-cache",
      },
    });
  return {
    ...Object.fromEntries(
      served.map((name) => [
        `/${name}`,
        () => new Response(Bun.file(join(dir, name)), { headers: HASHED }),
      ]),
    ),
    ...Object.fromEntries(Object.values(PAGES).map((path) => [path, page])),
  };
}

/**
 * Bun's `routes`: with `prebuilt` (the folder of a build), its files; in an executable, the files
 * it carries; otherwise the bundle at its own address, and each page's address serving it with
 * the policy.
 */
export function pageRoutes(development: boolean, prebuilt?: string) {
  const csp = contentSecurityPolicy(development);
  if (prebuilt)
    return builtRoutes(prebuilt, readFileSync(join(prebuilt, "index.html"), "utf8"), csp);
  if (EMBEDDED) return builtRoutes(EMBEDDED, readFileSync(homepage.index, "utf8"), csp);
  const bundle = `/_app/${crypto.randomUUID()}`;
  // Only the server's address is read, so any Bun server will do.
  const page = async (_: Request, server: Pick<Server<unknown>, "url">) => {
    const res = await fetch(new URL(bundle, server.url));
    const headers = new Headers(res.headers);
    headers.set("content-security-policy", csp);
    return new Response(res.body, { status: res.status, headers });
  };
  return {
    [bundle]: homepage,
    ...Object.fromEntries(Object.values(PAGES).map((path) => [path, page])),
  };
}
