import { Shell } from "@/web/components/shell/shell";
import { DataProvider } from "@/web/hooks/data.hook";

export function App() {
  return (
    <DataProvider>
      <Shell />
    </DataProvider>
  );
}
