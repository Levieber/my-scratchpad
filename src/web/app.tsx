import { lazy, Suspense } from "react";

import { Shell } from "@/web/components/shell/shell";
import { SearchProvider } from "@/web/hooks/search.hook";

// Query's devtools in development only: the production build drops this import unread.
const Devtools =
  process.env.NODE_ENV === "production"
    ? () => null
    : lazy(() =>
        import("@tanstack/react-query-devtools").then((m) => ({ default: m.ReactQueryDevtools })),
      );

export function App() {
  return (
    <SearchProvider>
      <Shell />
      <Suspense>
        <Devtools buttonPosition="bottom-left" />
      </Suspense>
    </SearchProvider>
  );
}
