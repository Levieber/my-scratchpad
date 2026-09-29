#!/usr/bin/env bun
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";

import { ApiError, Client } from "./client";
import { clientConfigPath, config } from "./config";
import { localDate } from "./daily";
import type { Note } from "./db";
import { isKind, KIND_NAMES, type Kind } from "./kinds";

const HELP = `pad — scratchpad CLI (talks to ${config.url})

Usage:
  pad add [text...] [-t title] [--tag x]... [--kind k] [--pin]   create a note (text or stdin)
  pad ls [query...] [--tag x]... [--kind k] [--pinned] [-n limit] list / full-text search
  pad show <id>                                        print a note
  pad append <id> [text...]                            append a line (text or stdin)
  pad edit <id>                                        edit body in $EDITOR
  pad set <id> [-t title] [--tag x]... [--kind k] [--pin|--unpin] update metadata
  pad rm <id>                                          delete a note
  pad history <id> [-n limit]                          list a note's revisions
  pad diff <id> [--from rev] [--to rev] [--since time] what changed (default: the latest change)
  pad today [YYYY-MM-DD]                               print (or create) the daily review
  pad tags                                            list tags
  pad status                                           show which server is in use
  pad login <url> [token]                              point CLI/MCP at a server (e.g. Railway)
  pad logout                                           back to the local server
  pad serve                                            run the API + PWA server
  pad open                                             open the PWA in a browser

Kinds: ${KIND_NAMES.join(", ")}. Search operators: pad ls kind:reference '#launch' seo
Global: --json for machine-readable output.
Env (overrides \`pad login\`): PAD_URL, PAD_TOKEN, PAD_AUTHOR.`;

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    title: { type: "string", short: "t" },
    tag: { type: "string", multiple: true },
    kind: { type: "string" },
    pin: { type: "boolean" },
    unpin: { type: "boolean" },
    pinned: { type: "boolean" },
    limit: { type: "string", short: "n" },
    from: { type: "string" },
    to: { type: "string" },
    since: { type: "string" },
    json: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});

const [cmd, ...args] = positionals;
const author = process.env.PAD_AUTHOR ?? (process.env.CLAUDECODE ? "claude-code" : "human");
const client = new Client(config.url, author);

const out = (data: unknown, human: () => string) =>
  console.log(opts.json ? JSON.stringify(data, null, 2) : human());

const ago = (iso: string) => {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};

// Progress means something on a to-do list; on a reference checklist it's just the item count.
const done = (n: Note) =>
  n.kind === "note" && n.progress.total ? ` ${n.progress.done}/${n.progress.total}` : "";

const line = (n: Note) =>
  `${n.pinned ? "★" : " "} ${n.id}  ${n.title}${done(n)}${n.kind === "note" ? "" : ` [${n.kind}]`}${n.tags.length ? "  #" + n.tags.join(" #") : ""}  (${ago(n.updated_at)}, ${n.author})`;

const full = (n: Note) =>
  `${n.pinned ? "★ " : ""}${n.title}\nid: ${n.id} · by ${n.author} · updated ${n.updated_at}${
    n.tags.length ? " · #" + n.tags.join(" #") : ""
  }\n\n${n.body}`;

async function textArg(rest: string[]): Promise<string> {
  if (rest.length) return rest.join(" ");
  if (!process.stdin.isTTY) return (await Bun.stdin.text()).replace(/\n$/, "");
  return "";
}

// Checked before sending so a typo fails with the flag's name rather than the API's field name.
function kindOpt(): Kind | undefined {
  if (opts.kind === undefined || isKind(opts.kind)) return opts.kind;
  throw new ApiError(400, `--kind must be one of: ${KIND_NAMES.join(", ")}`);
}

function need(id: string | undefined): string {
  if (!id) throw new ApiError(400, "Missing <id>. See `pad --help`.");
  return id;
}

async function main() {
  if (opts.help || !cmd || cmd === "help") return console.log(HELP);

  switch (cmd) {
    case "add":
    case "new": {
      const body = await textArg(args);
      if (!body && !opts.title) throw new ApiError(400, "Nothing to add: pass text or pipe stdin.");
      const n = await client.create({
        title: opts.title,
        body,
        tags: opts.tag,
        pinned: opts.pin,
        kind: kindOpt(),
      });
      return out(n, () => n.id);
    }
    case "ls":
    case "list":
    case "search": {
      const notes = await client.list({
        q: args.join(" ") || undefined,
        tag: opts.tag,
        kind: kindOpt(),
        pinned: opts.pinned || undefined,
        limit: opts.limit ? Number(opts.limit) : undefined,
      });
      return out(notes, () => notes.map(line).join("\n") || "(no notes)");
    }
    case "show":
    case "cat": {
      const n = await client.get(need(args[0]));
      return out(n, () => full(n));
    }
    case "append": {
      const id = need(args[0]);
      const text = await textArg(args.slice(1));
      if (!text) throw new ApiError(400, "Nothing to append.");
      const n = await client.append(id, text);
      return out(n, () => n.id);
    }
    case "edit": {
      const n = await client.get(need(args[0]));
      const file = join(tmpdir(), `pad-${n.id}.md`);
      await Bun.write(file, n.body);
      const editor = process.env.VISUAL ?? process.env.EDITOR ?? "vi";
      const proc = Bun.spawn([...editor.split(" "), file], {
        stdio: ["inherit", "inherit", "inherit"],
      });
      if ((await proc.exited) !== 0)
        throw new ApiError(1, "Editor exited with an error; note unchanged.");
      const body = await Bun.file(file).text();
      if (body === n.body) return out(n, () => "unchanged");
      const u = await client.update(n.id, { body });
      return out(u, () => u.id);
    }
    case "set": {
      const n = await client.update(need(args[0]), {
        title: opts.title,
        tags: opts.tag,
        kind: kindOpt(),
        pinned: opts.pin ? true : opts.unpin ? false : undefined,
      });
      return out(n, () => line(n));
    }
    case "pin":
    case "unpin": {
      const n = await client.update(need(args[0]), { pinned: cmd === "pin" });
      return out(n, () => line(n));
    }
    case "rm":
    case "delete": {
      const id = need(args[0]);
      await client.delete(id);
      return out({ deleted: id }, () => `deleted ${id}`);
    }
    case "history":
    case "log": {
      const revs = await client.revisions(need(args[0]), {
        limit: opts.limit ? Number(opts.limit) : undefined,
      });
      return out(revs, () =>
        revs
          .map(
            (r) =>
              `${String(r.id).padStart(6)}  ${r.updated_at}  +${r.added} -${r.removed}  ${r.author}  ${r.title}`,
          )
          .join("\n"),
      );
    }
    case "diff": {
      const rev = (v: string | undefined) => (v === undefined ? undefined : Number(v));
      const d = await client.diff(need(args[0]), {
        from: rev(opts.from),
        to: rev(opts.to),
        since: opts.since,
      });
      const fields = Object.entries(d.changes).map(
        ([field, c]) => `${field}: ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`,
      );
      return out(
        d,
        () => [...fields, d.diff.trimEnd()].filter(Boolean).join("\n") || "(no changes)",
      );
    }
    case "today":
    case "daily": {
      const n = await client.daily(args[0] ?? localDate());
      return out(n, () => full(n));
    }
    case "tags": {
      const tags = await client.tags();
      return out(tags, () => tags.map((t) => `#${t.tag} (${t.count})`).join("\n") || "(no tags)");
    }
    case "status": {
      const ok = await client.health().then(
        () => true,
        () => false,
      );
      const info = {
        url: config.url,
        reachable: ok,
        token: !!config.token,
        author,
        config: clientConfigPath,
      };
      return out(
        info,
        () =>
          `${config.url}  ${ok ? "reachable" : "UNREACHABLE"}${config.token ? " (token set)" : ""}  as ${author}`,
      );
    }
    case "login": {
      const url = need(args[0]).replace(/\/$/, "");
      const token =
        args[1] ??
        (process.stdin.isTTY ? prompt("Token (blank for none):") || undefined : undefined);
      const res = await fetch(`${url}/api/notes?limit=1`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      }).catch(() => null);
      if (!res) throw new ApiError(0, `Cannot reach ${url}`);
      if (res.status === 401) throw new ApiError(401, "Server rejected the token.");
      mkdirSync(dirname(clientConfigPath), { recursive: true });
      writeFileSync(clientConfigPath, JSON.stringify({ url, token }, null, 2) + "\n", {
        mode: 0o600,
      });
      return out(
        { url, saved: clientConfigPath },
        () => `Now using ${url} (saved to ${clientConfigPath})`,
      );
    }
    case "logout":
      rmSync(clientConfigPath, { force: true });
      return out({ removed: clientConfigPath }, () => "Back to the local server.");
    case "serve":
      (await import("./server")).start();
      return;
    case "open": {
      const opener = process.platform === "darwin" ? "open" : "xdg-open";
      Bun.spawn([opener, config.url]);
      return;
    }
    default:
      throw new ApiError(400, `Unknown command "${cmd}". See \`pad --help\`.`);
  }
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  if (opts.json) console.error(JSON.stringify({ error: msg }));
  else console.error(`pad: ${msg}`);
  process.exit(1);
});
