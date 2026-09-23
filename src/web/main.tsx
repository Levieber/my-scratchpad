import { createRoot } from "react-dom/client";

import { App } from "./App";

// PWA files are served from public/ at runtime; added here so the bundler doesn't try to resolve them.
for (const [rel, href] of [
  ["manifest", "/manifest.webmanifest"],
  ["icon", "/icon.svg"],
  ["apple-touch-icon", "/icon.svg"],
]) {
  const link = document.createElement("link");
  link.rel = rel!;
  link.href = href!;
  document.head.append(link);
}

createRoot(document.getElementById("root")!).render(<App />);

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
