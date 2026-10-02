// The server's entry point: `bun src/server.ts` (dev, start, the systemd unit). It stays at this
// path because installed units and Railway's start command name it; the code is in server/.
import * as BunRuntime from "@effect/platform-bun/BunRuntime";

import { main } from "@/server/serve";

BunRuntime.runMain(main, {
  teardown: function customTeardown(exit, onExit) {
    if (exit._tag === "Failure") {
      console.error("Program ended with an error.");
      onExit(1);
    } else {
      console.log("Program finished successfully.");
      onExit(0);
    }
  },
});
