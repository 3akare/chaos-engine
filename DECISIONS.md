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

## Phase 1 — simulation

- **Airborne horizontal motion.** With purely vertical falling, a `U` launch always falls back onto
  its own spring and an `L`/`R` fan can never move a falling ball, so the "launch pad" and "gap"
  families in §5.2 couldn't work. Two minimal additions:
  - A **`U` spring** launched while the ball has `dx ≠ 0` appends one `(dx, 0)` step after the
    three `(0, −1)` steps (it "hops up and over"). With `dx = 0` it is pure vertical (and usually
    loops: *perpetual motion*).
  - A ball at the **top cell of a `U` beam** slips sideways by `dx` instead of rising (it hovers and
    stalls if `dx = 0`), so a `U` fan is a lift, not an oscillator.
  - A **falling** ball inside an `L`/`R` beam is blown one cell sideways instead of falling.
- **One move per tick.** Landing doesn't use up a tick (the ball lands and rolls in the same tick)
  unless the surface fires a rule (spring launch, bumper hop). A ball rolling off a ledge falls in
  the next tick with no hang time.
- **Top edge is a ceiling**; the sides and bottom are the void (`lost`).
- **Loop detection** hashes state only on ticks where the ball moved or something fired; resting
  ticks feed the stall counter instead, so a resting ball is `stalled`, never `loop`.
- **Variant arcs** keep a 4-column reach: `UR` is 2 up-right + 2 right; HEAVY 1 + 3; BOUNCY 3 + 1.
  HEAVY `U` rises 2, BOUNCY 4. BOUNCY bumper hop is two diagonal steps.
- **Touch events** fire once per contiguous contact for fans and resting-on-top; ramps, springs and
  bumpers fire on every interaction. These feed "Most Touched".
- **Fixtures** were hand-built against the validator (`dev/tools/check-machine.ts`); each delivers
  3–4 of the 6 variants with zero single-piece fixes. Their golden runs are snapshot-tested.

## Phase 2 — generator

- **Layout.** Three bands fill rows 1–12 (heights 3–5, summing to 12) and rows 13–14 are a fixed
  "finish tray" (floor + target). The tray can carry a fix of its own (family `finish`), so
  tier 3's four fixes are 3 band fixes + the tray. Tier 1/2 put funnels in the unused slots (never
  two funnels in a row).
- **Per-band verification.** Each band is checked with the real sim twice: with its fix the ball
  must exit the band's bottom edge within 60 ticks; without it the ball must *not*. If a family
  can't fit at the entry column after 20 parameter rolls, other families of the same height are
  tried before the whole machine is re-rolled.
- **"Interesting failure" is enforced while building band 1**, not only at validation, which cut
  the median from 19 to 9 attempts (max 46 over 100 days, ≤ 40 ms per Day).
- **Validation order** is cheapest-first (headroom and variety before the permutation and
  single-piece sweeps). The 5,000-sim budget is applied per validated attempt.
- **Fan-corridor fix**: the fan sits in the dead-end direction, both blocking the ball and blowing it
  back — no extra rule needed.
- **Names** come from the dominant family's word list; the target is a bell or basket at random.

## Phase 3 — server

- **Extra key** `ce:daynum:{n} → dayId` (for "yesterday" and idempotent Day creation).
- **Transactions.** `watch/multi/exec` covers hashes and sorted sets in Devvit, so placement writes
  `pieces`, `inv`, `holder`, `events`, the displaced player's `inbox` and stats in one MULTI, as
  specified. Resolve writes result, status, sub stats, user stats, leaderboard and inboxes in one
  MULTI too, so retrying it never double-counts.
- **Move/edit keeps the piece id and `placedAt`** (it is the same piece); `editedAt` is set.
- **The results comment can't link tomorrow's post** (it is posted before the hand-off creates
  it), so it says "A new machine is up now — find it in the newest post." and the run screen's
  "Build today's machine →" button links the newest post.
- **Inbox** shows items newer than `lastSeenTs`; `/api/inbox/ack` bumps it.
- **Realtime** is skipped for now; the client polls `/api/state` every 15 s while visible.
- **Demo seeding** places every solution piece except the lowest one as labelled setup pieces, so
  Ball 1 travels most of the machine and visibly fails near the end — one piece away from a fix.

## Phase 3–4 — client

- **Run screen is a controller, not a second Phaser scene.** `src/client/game/run.ts` drives the
  same `BoardScene` (follow camera, per-tick slow-mo, owner labels) with DOM overlays for the
  reveal, banners, tally and results. One renderer, one set of art.
- **Client previews use the shared rules engine** (`decide()`), so the verdict and the reason in
  the palette are exactly what the server will say; the server still re-runs everything.
- **The board shrinks while the palette sheet is open** so the whole ghost path stays visible.
- **Lock deadline.** The cron runs every 10 minutes, so between `locksAt` and the next tick the Day is
  still `OPEN`. Placements and predictions are refused once `now >= locksAt` regardless, and the
  client shows "Firing up the machine…" in that window.
- **Splash** draws the machine with a 2D canvas (`src/client/lib/miniBoard.ts`); it ships ~31 KB
  of JS+CSS and never loads Phaser. The game bundle is ~1.2 MB (Phaser 3).
- **Personal reports** appear after the reveal-and-runs sequence on resolved posts, not over it.
- **Sound** is not implemented (optional in the plan).
