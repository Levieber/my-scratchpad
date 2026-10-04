import { lazy, Suspense } from "react";

import { DeleteDialog } from "@/web/components/editor/delete-dialog";
import { Shell } from "@/web/components/shell/shell";
import { TokenDialog } from "@/web/components/shell/token-dialog";
import { Toaster } from "@/web/components/ui/sonner";
import { TooltipProvider } from "@/web/components/ui/tooltip";
import { SearchProvider } from "@/web/hooks/search.hook";

// Query's devtools in development only: the production build drops this import unread.
const Devtools =
  process.env.NODE_ENV === "production"
    ? () => null
    : lazy(() =>
        import("@tanstack/react-query-devtools").then((m) => ({ default: m.ReactQueryDevtools })),
      );

/** The providers, the shell, and what overlays it (dialogs, toasts), portalled to the body. */
export function App() {
  return (
    <SearchProvider>
      <TooltipProvider delay={400}>
        <Shell />
        <TokenDialog />
        <DeleteDialog />
        {/* Above the home indicator and beside a notch, wherever the phone puts them. */}
        <Toaster
          position="bottom-center"
          mobileOffset={{
            bottom: "max(16px, env(safe-area-inset-bottom))",
            left: "max(16px, env(safe-area-inset-left))",
            right: "max(16px, env(safe-area-inset-right))",
          }}
        />
      </TooltipProvider>
      <Suspense>
        <Devtools buttonPosition="bottom-left" />
      </Suspense>
    </SearchProvider>
  );
}
