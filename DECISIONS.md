# Design decisions

A running log of decisions made during the build that the plan (`PLAN.md`) did not settle,
or where the implementation deviates from it. Newest last.

## Phase 0

- **Template.** Started from `reddit/devvit-template-phaser` (Nov 2026, Devvit 0.15.4, Hono, Vite 8).
- **Phaser 3, not 4.** The current template ships Phaser 4; the plan specifies Phaser 3.
  We pin `phaser@3.90.0` (last v3) because its API is stable and well documented.
- **Entry HTML location.** The Devvit Vite plugin derives output paths from `src/client/`, so
  `splash.html` and `game.html` live directly in `src/client/`, with their code in
  `src/client/splash/` and `src/client/game/` as the plan's layout suggests.
- **Ports, not globals.** Server core never imports `@devvit/web/server`. It receives a `Deps`
  object (`store`, `reddit`, `now`, `randomBytes`, `log`) — see `src/server/core/deps.ts`.
  `src/server/devvit.ts` wires the real runtime; the harness and tests wire in-memory fakes.
- **Redis verified against `@devvit/redis` 0.15.4 types:** default scope is `INSTALLATION`
  (per subreddit), so keys are not prefixed with a subreddit id. `watch()` returns a
  `TxClient` that supports `set/del/hSet/hDel/hIncrBy/zAdd/zIncrBy/...`, so one transaction
  can cover strings, hashes and sorted sets. `set` supports `{ nx, expiration }` (lease lock).
  An aborted EXEC is detected as: throws, returns null, or returns fewer results than queued.
- **Reddit verified:** `submitCustomPost`, `submitComment` (+ `distinguish(sticky)`),
  `getNewPosts` and `getComments` exist and expose `authorName` and `createdAt`, so the
  duplicate-recovery search in §2.1 is implementable as specified.
- **Harness.** `dev/harness` builds the real client entries with Vite, aliasing
  `@devvit/web/client` to `dev/harness/fake-devvit-client.ts`. The server mounts
  `createApp()` (the same route handlers) over `MemoryStore` + `FakeReddit`. The user is a
  cookie (`ce_user`), the post id a query param.
- **Node.** Template asks for Node ≥ 24; the dev container has Node 22, which works.
  `.npmrc` sets `legacy-peer-deps` to dodge an npm arborist crash with vitest's peer graph.
