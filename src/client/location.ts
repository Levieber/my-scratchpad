// Where an agent or a command is working, as the hook endpoints take it (shared/hooks.ts): the
// repository's name, the folder inside it, the absolute folder, and the home directory that
// `~/` scopes are relative to. Two `git` runs, a few ms each.
import { homedir } from "node:os";

import { repoName, type Location } from "@/shared/hooks";

const git = (cwd: string, ...args: string[]) => {
  const run = Bun.spawnSync(["git", "-C", cwd, ...args], { stderr: "ignore" });
  return run.success ? run.stdout.toString().trim() : undefined;
};

export function locate(cwd: string, home = homedir()): Location {
  // One run answers both: the top-level folder, then the path from it with a trailing slash.
  const [toplevel, prefix = ""] = git(cwd, "rev-parse", "--show-toplevel", "--show-prefix")?.split(
    "\n",
  ) ?? [undefined];
  if (!toplevel) return { dir: cwd, home };
  const remote = git(cwd, "config", "--get", "remote.origin.url");
  return { repo: repoName(remote, toplevel), path: prefix.replace(/\/$/, ""), dir: cwd, home };
}
