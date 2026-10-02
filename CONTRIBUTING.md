# Contributing

Thanks for helping. The short version: keep the API as the only way in, and keep every change tested.

## Setup

```sh
bun install
bun run dev          # http://127.0.0.1:7777 with HMR
```

Bun is the only toolchain: no Node, npm, Jest, Vite or Express.

## Before opening a pull request

```sh
bun test && bun run lint && bun run typecheck
```

`bun run lint:fix` fixes formatting and what oxlint can fix itself. Fix findings rather than disabling rules.

## Rules that apply to every change

- **API first.** Clients (PWA, CLI, MCP, hooks) talk to the HTTP API and never import `db.ts`, `migrations.ts` or `server.ts` at runtime. A new capability lands as a route, an `openapi.ts` entry and a test, and only then in the clients. `test/architecture.test.ts` enforces the boundaries.
- **Imports by alias.** Never `../`: `@/` is `src/`, `@integrations/` is `integrations/`, `./` is for a sibling. Effect modules by path (`effect/Effect`), never a barrel. See [docs/effect.md](docs/effect.md) for how Effect is used here.
- **Errors are codes.** Responses are `{ error: <code from src/errors.ts>, message }`; add a code rather than inventing a string.
- **Migrations are append-only.** A schema change adds a migration to `src/migrations.ts`; never edit one that has shipped.
- **Comments explain a decision.** Don't narrate the code.
- **Docs move with the code.** [docs/architecture.md](docs/architecture.md) explains the structure; when a change alters it, update it in the same pull request.

## Reporting a problem

Open an issue with what you did, what you expected and what happened. For a security problem, don't put details in a public issue; contact the maintainer privately first.

## License

By contributing you agree that your contribution is released under the [MIT License](LICENSE).
