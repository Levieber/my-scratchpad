// The PWA's pages, with the Content-Security-Policy they are served under. Note bodies are written
// by agents and may one day be written by other people; the renderer escapes their HTML and drops
// executable links (web/components/editor/note-markdown.tsx), and this policy is the second line:
// only this site's own scripts run, and the page talks to nothing else.
//
// Bun bundles the app from the HTML import and serves it itself, ahead of the Effect router, with
// no way to add a header. So the bundle answers at an address of its own, unguessable and new on
// each start, and every page's address fetches it from there over loopback and adds the policy.
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

/** Bun's `routes`: the bundle at its own address, and each page's address serving it with the policy. */
export function pageRoutes(development: boolean) {
  const bundle = `/_app/${crypto.randomUUID()}`;
  const csp = contentSecurityPolicy(development);
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
