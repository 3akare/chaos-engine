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

## After the first playtest

- **Solo and community modes are one rule.** One piece per person made a quiet subreddit (or a
  lone tester or judge) unable to finish any machine, since every fix needs 2–4 pieces. A player
  may now hold `ceil(piecesNeeded / buildersToday)` pieces (at least one), where builders counts
  everyone holding a piece plus the player acting. Alone you can build the whole fix; with as many
  builders as pieces needed it is one each. `/api/place` takes an optional `from` socket (which of
  your pieces moves) and `/api/remove` an optional `socketId`. The holder index stores a JSON list of
  sockets per user, rewritten in the same MULTI. The `LIMIT` error asks you to pick a piece to move.
- **Schedule: 02:00 UTC daily.** Lock/hand-off moved from 12:00 to 02:00 UTC. A Day opened off
  schedule (install, Run now) runs at least 12 h, so the first day never produces a second new game
  the same day. Existing installs migrate once on the next tick (`scheduleVersion`), moving the open
  Day's lock to the next 02:00 that is at least 6 h away.

## 2026-11-24 · Simpler rules, varied puzzles, sharper art
- **No guessing.** The score prediction is gone from the game (the server still accepts it, nothing shows it). The night's result is stars: one per ball that reaches the flag. The results comment says "⭐⭐☆ 2 of 3 balls reached the flag".
- **Varied puzzles (generator v2).** Measured over 60 days, v1 solutions were mostly ramps and never used a spring, and players got spare pieces of every type, so a ramp fixed everything. v2: no bumpers in new machines; at most one ramp (two on Fridays/Saturdays); each weekday features a spring or a fan (Friday both) with a fallback pass if it can't be built; stock is exactly the solution's pieces; the surprise-ball headroom allows 5/6 so spring days aren't all rejected. Test: 100 days, ≥25 spring days and ≥25 fan days, never one kind of piece.
- **Sharp on phones.** The Phaser canvas is sized at devicePixelRatio and shown at 1/PX zoom; it was rendering at 1x and being stretched.
- **A real fan.** Drawn in the pack's style (dev/assets/fan.svg.html): a housing with spinning blades, and moving wind in front of it.
- **Plain names.** Surprise balls are Lefty, Righty, Heavy, Bouncy, Backwards, Slick, each with its own colour.

## 2026-11-24 · Solo and Team, three fixed balls
- **Two ways to play, chosen on the post.** Solo: your own copy of the day's machine with its full stock; ▶ rolls the three balls; `/api/solo` re-simulates the arrangement server-side and keeps your best (hash `ce:day:{id}:solo`). Team: the shared board as before (allowance = ceil(needed / builders), improve-only replacement), ▶ shows what it would score now, and at 02:00 UTC the real roll.
- **Three fixed balls: normal, heavy, bouncy.** Same every day, shown up front; the random secret variants and the reveal are gone from the game (the server still stores the commit/secret, harmlessly). Every generated machine's solution must get all three home (the hand-made fallbacks are exempt and only need the normal ball).
- **No per-ball replay keys.** ▶ (Solo/Team test) or "Watch again" (night) rolls all three again.

## 2026-11-24 · Harder, fairer puzzles; Solo has its own machine
- **No live path preview.** It turned the puzzle into "turn the piece until the line hits the flag". You now find out by rolling; afterwards each ball's trail stays on the board in its colour, with a ✕ where it was lost.
- **Solution-space census** (`shared/generator/solveSpace.ts`): every arrangement of the day's pieces (any + spot, any turn, or unused) is simulated. A machine passes if ≥1 arrangement gets all three balls home, ≤2% of arrangements do (not luck), and ≥30% of normal-ball wins lose the heavy or bouncy ball (the balls matter). Median generation ~140 ms. A last-resort pass relaxes the 30% rule (marked `gen.relaxed`), and the test allows at most 10 such days in 100.
- **Solo machine ≠ Team machine.** Generated with a `:solo` salt, kept apart from the Team layout by the variety check, stored at `ce:sololevel:{n}`; `/api/solo` scores against it. `/api/solo/hint?n=` reveals Solo solution pieces one at a time (offered after 3 tries without 3 stars).
- **Placing pieces from a bubble** next to the tapped spot (pick / turn / remove, or turn / place / cancel in Team) instead of a dock tray that overflowed narrow phones. Checked at 320 px.

## 2026-11-24 · Ball pour replaces the grid game

Playtesting said the grid game had "zero excitement": you watched three balls move square by square and got a star or not. The ball-pour prototype (real physics, 100 balls, sound) was fun immediately, so the game is now that, with a daily leaderboard as the competition.

- **One fixed pour per day.** Everyone gets the same 100 balls (the chute's wobble is seeded per machine). Your build is the only variable, so the leaderboard is skill, not luck, and any score can be re-run.
- **The server re-runs scores.** A pour that would raise your best is simulated again on the server (≈0.15 s); the server's count is saved. Pours that don't raise your best only add to the shared total.
- **Deterministic trig.** Matter.js calls `Math.sin/cos` every step for every rotating body. Those differ by an ulp between V8 and JavaScriptCore, which is enough to change a score. While the sim runs they're swapped for fdlibm-kernel versions built from + − × ÷ and `Math.round` only. Verified bit-identical between Node and Bun.
- **Builds hidden until close.** Revealing the winner only after 02:00 UTC stops the leader being copied, and gives the next day's post a reason to exist (Build of the Day).
- **Community without a shared board.** A shared board was what made the old Team mode feel lame. The subreddit instead has a daily goal (balls caught by everyone) and a streak.
- **Machines are made offline.** Vetting a machine takes a few hundred pours (a minute of CPU), too slow for the scheduler, so a vetted pack ships with the app and later days reuse it mirrored and re-seeded.
- **Removed:** the grid sim, its generator and fixtures, Solo/Team, the three ball types, the commit-reveal seal (nothing secret is drawn any more), Phaser.

## 2026-11-25 · Solo and Daily, a goal sized to who played, one game a day, solutions on closed days

From David's playtest:
- **Names.** "Personal" is now **Solo** and "Group" is **Daily** on screen. Code, routes and storage keep the old names (`personal`, `group`, `ce_mode`) so saved progress carries over.
- **Your best in the corner.** The top-right chip shows the stars and a labelled "Best" score on both screens (Daily: your best today and rank; Solo: your best on the level).
- **The goal counts each player once.** The old goal added every pour's balls and grew 10% a day, so one player pouring forty times could fill it and a small subreddit could never reach it. Now the total is each player's best pour (at most 100 each), and four tiers (Good / Great / Super / Extreme) are "everyone averages 35 / 55 / 75 / 90% of the machine's best known score" (`shared/goal.ts`). The streak counts days at Good or better. `meta.goal` is no longer used.
- **The goal does not chase the solution.** An offline search (`dev/pour/perfect.ts`) found 100-ball builds for Dizzy Ledge, Wobbly Shortcut and Bouncy Gauntlet, and better builds for the other four (93, 97, 88, 88). Those become `gen.best`/`gen.par`, which a closed day shows as its solution. The goal is sized against `gen.goal` instead, fixed at each machine's earlier best (77 to 98), so finding a perfect build never makes a day's goal harder for players.
- **One new game a day, at 02:00 UTC.** A version that moved its data to new keys made an upgrade look like a fresh install, which posted a second game the same day. Install now checks the subreddit for a game this app posted since the last 02:00; if there is one (or the check fails), Day 1 is held until the next 02:00. A first game opened off-schedule now ends at the next 02:00 (at least an hour away) instead of running 12 h+, so the next game comes on time. "Run now" is gone from the moderator menu (it opened a second game the same day); `runNow` stays for tests and the browser playtest.
- **Closed days show the solution.** Once a day is no longer open, its post shows the machine's best known build ("Watch the solution"), poured once on that exact machine and cached (`ce2:day:{id}:solution`), since later days reuse machines mirrored or re-seeded. Never sent while the day is open. `dev/pour/perfect.ts` searches for 100-ball builds and merges any improvement into `pack.json`.

## 2026-11-25 · Daily first, the goal in sight, Solo becomes Practice
- **One daily puzzle, counted twice.** Each player's best pour ranks them on the leaderboard and adds to the community goal. Two separate daily modes (a ranked one and a shared one) would split a small subreddit across two machines and double the daily content, so they stay one.
- **The goal is visible before anyone plays.** It was only on the leaderboard card after a pour. Now a "Together" strip (`client/lib/goal.ts`) is on the feed card under the buttons and under the game's top bar in Daily, with tier marks and "N more for <tier>". Once you've played, the post shows today's leaderboard instead (top 3, or top 2 and you), with the community rating in its header, and steps everything down a size so it fits a phone's post (about 440px).
- **Solo is renamed Practice.** Its fixed levels with "Next level" read like the daily game. Daily is now the first button and the first tab.

## 2026-11-25 · Pour today, the goal and the board on the post
- **One call to action.** The post leads with "Pour today" (on a closed day, "See the solution"). Practice is a small pill next to the logo: it's a warm-up, not the daily game.
- **Goal, then leaderboard, always.** Under the button, the goal box (fill / next rating's target, the rating badge, a bar in the ball colours whose colour shows how far the subreddit has got), then the top 3 and you if you're further down. Three post heights get their own sizes (tall, phone around 440px, regular 320px).
- **No goal strip in the game.** It took height from the board; the goal is in the leaderboard card instead, and the board fills the space again.

