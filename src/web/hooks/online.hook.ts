import { useStore } from "@/web/hooks/store.hook";
import { onConnectivity } from "@/web/lib/api";
import { Store } from "@/web/lib/store";

// Every request reports whether the server answered (lib/api.ts), so the app shows the
// connection as it is rather than guessing from navigator.onLine.
const online = new Store(true);
onConnectivity(online.set);

export const useOnline = () => useStore(online);
