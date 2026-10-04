import { useSyncExternalStore } from "react";

import type { Store } from "@/web/lib/store";

export const useStore = <T>(store: Store<T>) => useSyncExternalStore(store.subscribe, store.get);
