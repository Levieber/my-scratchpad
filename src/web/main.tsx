import { createRoot } from "react-dom/client";

import { App } from "./App";

// PWA files are served from public/ at runtime; added here so the bundler doesn't try to resolve
// them. (The apple-touch-icon is a static tag in index.html instead: iOS reads it when the page is
// added to the home screen, and the bundler can hand it over as an asset.)
for (const [rel, href] of [
  ["manifest", "/manifest.webmanifest"],
  ["icon", "/icon.svg"],
] as const) {
  const link = document.createElement("link");
  link.rel = rel;
  link.href = href;
  document.head.append(link);
}

createRoot(document.getElementById("root")!).render(<App />);

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
