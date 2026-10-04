// The server's entry point: `bun src/server.ts` (dev, start, the systemd unit). It stays at this
// path because installed units and Railway's start command name it; the code is in server/.
import * as BunRuntime from "@effect/platform-bun/BunRuntime";

import { main, teardown } from "@/server/serve";

BunRuntime.runMain(main, { teardown });
