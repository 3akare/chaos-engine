# Chaos Engine — Build Plan

> Build together. Let chaos take over.
> A daily cooperative machine-building game for Reddit, built on Devvit Web.

This file is the source of truth for the build. Read it fully before writing code. Work phase by phase (section 10) and do not start a phase until the previous phase's exit gate passes.

---

## 0. Context and hard constraints

- **Event:** Reddit's Game of the Day Hackathon (Devpost). Submission deadline **Tue Dec 8, 2026, 6:00 pm PT**. Judging Dec 9–16, 2026.
- **Judging:** four equally weighted criteria: Delightful UX, Polish (close to launch quality, compliant with Devvit Rules), Reddity (community-minded, fresh), Daily Content (recurring content and intrigue). Ties are broken in that order, so UX matters most.
- **Judges may never open the game.** They can judge from the description, images and a video under 1 minute. The first 10 seconds of the video and the splash card must sell the concept.
- **Required for submission:** a Devvit Web app using Interactive Posts; the app listing link (`developers.reddit.com/apps/{app-name}`); a detailed `README.md` in the repo root describing the game and how to play; a link to a public test subreddit with **fewer than 200 members** plus a post running the game (or install `dr-admin-approve` in the subreddit).
- **Solo developer, fully agentic build.** Claude Code does the implementation.
- **The dev machine is unreliable under heavy load.** Keep tooling light: no heavy local simulations, no large Docker stacks. This game's simulation is tiny, so that's fine.
- **`devvit playtest` uploads builds to Reddit.** There is no Vite dev server or HMR. You must build a **local harness** (section 6.5) to iterate without Reddit.
- **A working Reddit account is required** for `devvit login`, playtest, upload and the demo post. Phases 0–4 must be fully completable without one.
- **Prior art:** *Grudgeball* (Reddit "Games with a Hook", Jul 2026) is a crowd-built marble board, adversarial, with per-player drops. Chaos Engine must read as different: **one cooperative machine per day, one big secret-ball reveal, predictions.** Keep that framing in the README and Devpost text.

---

## 1. The game in one paragraph

Every day the subreddit gets one shared, partly built machine on a small grid, plus a goal (e.g. "ring the bell"). Each player can hold **one** piece on the board (ramp, spring, fan or bumper). Anyone can run unlimited **test runs** with the standard ball to see what the machine does right now. A placement can never lower the standard ball's progress score (section 4.7), and you can replace someone else's piece only if your version is strictly better. At the daily lock the machine fires **three balls**. Ball 1 is the standard ball. Balls 2 and 3 are secret variants (heavy, bouncy, offset…) drawn from a seed whose hash was published when the day opened. The community scores 0–3. Players predict the score beforehand, awards go to the pieces that mattered (computed by counterfactual reruns), and the app posts the results as a comment. A new machine opens the same minute.

**Why it works:**
- Decisions matter: you can test and see your effect.
- Chaos is real: secret balls, dormant pieces, and later players changing the route.
- Griefing is impossible by rule.
- Every Day's machine is **procedurally generated, proven solvable and validated** (section 5), so the content never runs out and needs no human level design.
- It supports thousands of community participants (watching, predicting, inspecting pieces, discussing) but only a limited number of simultaneous builders. Board capacity is part of the design; there is no voting.
- Every post is alive at any hour.

---

## 2. Core rules (final; implement exactly)

### 2.1 Days and posts
- One **Day** = one challenge = one Reddit post.
- The Day's lock time is a fixed UTC time (default **12:00 UTC**; make it configurable).

**Daily pipeline (crash-safe).** Each Day moves through these stages. Each stage commits its own state, so any stage can be retried on its own:

| Stage | What happens to reach it | Stored on success |
|---|---|---|
| `OPEN` | Accepting placements and predictions | — |
| `LOCKED` | Set atomically (watch/multi/exec) once `now >= locksAt`. All placements and predictions are refused from here on. | `lockedAt` |
| `RESOLVED` | Run `runDay` on the frozen board with the revealed secret; write the result, awards, stats and inboxes. Deterministic, so recomputing on retry is safe. | `result` JSON |
| `COMMENTED` | Post the results comment. | `resultsCommentId` |
| `HANDED_OFF` | Load the **pre-generated** machine for the next Day (section 5.5; never generate on this path). Create the next Day record (machine, secret, commitHash, status `CREATING`); create its Reddit post; store the post id; set it `OPEN`; point `ce:day:current` at it. | `nextDayId`, next Day's `postId` |

- **Cron runs every 10 minutes** (`/internal/cron/tick`).
  - It takes a lease lock (`ce:lock:daily`, set-if-absent with about 5 min expiry; verify that Devvit Redis supports this).
  - It advances the current Day through as many stages as are due and succeed.
  - A failure leaves the stage pending for the next tick, so recovery is automatic.
  - The mod action **Run now** sets `locksAt = now` and calls the same handler. There is never a second code path.
- **No duplicate Reddit objects:**
  - Before calling Reddit, store an attempt marker (`commentAttemptAt` / `postAttemptAt`).
  - **Deterministic markers:**
    - Every daily post title contains `Chaos Engine · Day N` (N = day number), e.g. `Chaos Engine · Day 23 · Fan Corridor`.
    - Every results comment ends with the line `Chaos Engine · Day N results`.
  - **On retry with a marker but no stored id,** search before creating:
    - For posts: search the subreddit's newest posts authored by the app account (enough to cover at least the last 3 days) for the exact title marker.
    - For comments: search the app account's comments on that Day's post for the exact comment marker.
  - **One match:** adopt it and store its id.
  - **Several matches:** adopt the earliest. Record the others in `ce:dupes` for moderator cleanup (mod menu **Show duplicates**).
  - **No match:** only now create it.
  - **If the search call itself fails, do not create anything.** Leave the stage for the next tick.
  - Verify in the Devvit docs that these listing and comment-reading APIs exist and return author and creation time before implementing this. If they don't, fall back to storing the attempt marker and accepting a rare duplicate that a moderator removes.
- **The client handles every stage:**
  - `OPEN`: build.
  - `LOCKED` or `RESOLVED` without a comment yet: "Firing up the machine…", polling until the result exists.
  - `RESOLVED` and later: the run screen.
- There is no dead window between days. Resolved posts stay viewable forever as replays. **The posts are the history; do not build a separate history screen.**

### 2.2 Pieces and sockets
- The board has **sockets**: specific cells where player pieces may sit, defined per machine.
- Player pieces (MVP): **Ramp, Spring, Fan, Bumper.** Conveyor is a stretch goal.
- Level-only pieces (placed by the generator, never by players): **Wall/Floor, Switch, Gate, Checkpoint, Target, Start.**
- Each player piece has an orientation (section 4.4).
- **Inventory:** each Day has limited stock per piece type. Placing a piece takes from stock; a piece that is removed or replaced returns to stock.

### 2.3 One active piece per player
- A player may have **at most one** piece on the board at a time.
- If someone replaces your piece, you have zero pieces and **may place again**. This is a deliberate return hook.
- You may move, re-orient, swap the type of, or remove your own piece while the Day is OPEN, following the action matrix in 2.5.
- **Invariant:** after any action, a player holds at most one piece, and the `holder` and `pieces` records always agree.

### 2.4 Test runs
- Unlimited, client-side, instant, and free.
- Test runs always use **Ball 1 (standard)**.
- The placement sheet shows a live **ghost preview**: the test run with your candidate piece in place, before you commit.

### 2.5 Placement validity (server-authoritative, inside a Redis transaction)
Let `P(board)` be Ball 1's progress score (section 4.7). The promise to players is exactly this: **a placement cannot reduce Ball 1's progress score as defined in 4.7.** It is not a promise that the machine improved in every sense; Balls 2 and 3 can be helped or hurt by any placement, by design. For any player action:

**Action matrix.** The server infers the action from what you hold and what you target. `before` and `after` are always the full boards.

| You hold | You target | Action | Rule | Error code |
|---|---|---|---|---|
| nothing | empty socket | **Place** | `P(after) >= P(before)` | `WOULD_HURT` |
| nothing | another player's (or setup) piece | **Replace**: their piece is removed | `P(after) > P(before)` | `MUST_IMPROVE` |
| a piece at S | empty socket T | **Move**: S becomes empty | `P(after) >= P(before)` | `WOULD_HURT` |
| a piece at S | S itself | **Re-orient or swap type in place** | `P(after) >= P(before)` | `WOULD_HURT` |
| a piece at S | another player's piece at T | **Move and replace**: S becomes empty and their piece is removed | `P(after) > P(before)` | `MUST_IMPROVE` |
| a piece at S | remove | **Remove** | `P(after) >= P(before)` | `WOULD_HURT` |
| anything | a pre-placed level piece | not allowed | — | `NOT_REPLACEABLE` |
| anything | anything, Day not OPEN | not allowed | — | `LOCKED` |

**Stock accounting order:**
1. Return to stock every piece the action removes (your old piece and any displaced piece).
2. Then check stock for the new piece and take it, or fail with `OUT_OF_STOCK`.

This way, moving or swapping is never blocked by an empty stock of the piece you already hold.

A displaced player gets an inbox item and is free to place again.

- Pre-placed level pieces can never be replaced.
- Setup pieces from the seed or demo tool are labelled `u/chaos-engine (setup)` and **can** be replaced by players under the improve rule.
- **Verdict labels** are exactly `Better progress ✓`, `Same progress ✓` and `Lower progress ✗`. Never just "Better" or "Worse". Always add the event-based reason, e.g. *"Lower progress ✗: Ball 1 now falls into the void at E9 instead of reaching checkpoint ②."* The client computes the explanation from the two sim results.
- How-to-play states it plainly: *"Only Ball 1's progress is protected, not whether the machine will win."*
- Pieces that Ball 1 never touches pass `>=` trivially. These **dormant pieces** are intended. They can wake up when someone upstream changes the route, or when a secret ball takes a different path. This is a key source of emergent chaos.

### 2.6 The Run (at resolve)
- Three balls run independently on the final board: Ball 1 standard, plus Balls 2 and 3 as two distinct variants picked by the Day's seed from the public variant list (section 4.6).
- **Commit–reveal:** at Day open, generate a random 32-byte secret and store it server-side only. Publish `sha256(secret)` in the game UI ("Today's secret balls are sealed: 3fa9…"). At resolve, reveal the secret. Variant selection is `rng(seed(dayId, secret))`. The UI shows the hash check so players can see it was fair.
- **Community score** for the Day = number of balls that reached the goal (0–3). Secondary display: total checkpoints across the balls.

### 2.7 Predictions
- Any user may predict the Day's score (0, 1, 2 or 3) while OPEN, and change the prediction until lock.
- After the reveal, show the distribution and whether you were right. Track a personal prediction streak.
- This gives non-builders (and judges) a meaningful action in a few seconds.

### 2.8 Awards (computed at resolve, all deterministic)
- **MVP:** the player piece whose removal causes the largest drop in the Day's outcome. Outcome order: balls delivered, then total checkpoints, then summed progress. Ties go to the earliest placement.
- **Most Touched:** the player piece touched by balls the most times across all three runs.
- **Clutch:** the last placement before lock that strictly raised `P`.
- Never call a piece a "saboteur" or name-and-shame. Awards are positive only.

### 2.9 Community and personal stats
- **Subreddit:** current streak of Days with at least 1 ball delivered, best streak, perfect days (3/3), total Days.
- **Personal:** pieces placed, pieces that touched a ball in the final run, MVPs, prediction streak.
- No currencies, levels, unlocks or profiles beyond this.

### 2.10 Personal report (return hook)
When a user opens the game and something happened to their piece since their last visit, show a one-time modal. Examples:
- *"u/kestrel replaced your ramp at C7 with a better one. You're free to place again."*
- *"Your spring at F4 launched Ball 3 (HEAVY) into the bell. MVP!"*

---

## 3. Explicitly out of scope (do not build)

- Proposal or voting systems, contribution rotation, adaptive board sizes per community size.
- A physics engine (Matter.js, Box2D) or any float-based physics.
- Free-form drawing, user-created components, in-game chat or free text (Reddit comments are the discussion layer).
- Player levels, currencies, marketplaces or profiles beyond section 2.9.
- A hand-authored level catalogue (there are only 5 fixtures, for tests and emergency fallback; see 5.6).
- AI-generated levels, and any general search-based solver. The generator *constructs* each solution; see 5.2.
- Multiple machines per Day, private rooms, PvP.
- A separate history UI (old posts are the history).
- Sprite sheets with several art states per component (use procedural tweens; section 7.5).

---

## 4. Simulation spec (`src/shared/sim`): the heart of the game

### 4.1 Principles
- **Pure TypeScript.** No DOM, no `Date`, no `Math.random`, no floats anywhere in game state. Integers only.
- **One module, used everywhere.** The client uses it for test runs, ghost previews and replays. The server uses it for validating placements and resolving the Day. The same inputs must always produce byte-identical outputs.
- Replays are **recomputed** from the stored board plus the revealed seed. Do not store frame logs in Redis.
- The numbers below are starting values. Tune them for fun in Phase 1, then lock behaviour with golden tests.

### 4.2 Grid
- Portrait, **9 columns × 14 rows** (fits 360 px wide phones at about 38 px per cell).
- `x = 0..8` runs left to right; `y = 0..13` runs top to bottom. Gravity is +y.
- Display coordinates for humans: columns `A–I`, rows `1–14` (for example `C7`). Draw these labels on the board edges so people can reference cells in Reddit comments.

### 4.3 Ball state
```ts
type Mode = 'fall' | 'roll' | 'fly';
interface Ball {
  x: number;
  y: number;
  dx: -1 | 0 | 1;
  mode: Mode;
  flyQueue: Array<[dx: number, dy: number]>; // queued offsets while airborne
  variant: VariantId;
}
```

### 4.4 Cells and pieces

| Piece | Who places | Orientations | Behaviour |
|---|---|---|---|
| Empty | — | — | Passable |
| Wall / Floor | level | — | Solid. Landing on its top switches the ball to `roll`. |
| Ramp | player | `DL`, `DR` | Passable deflector. When the ball enters, set `dx` to the ramp direction (−1 or +1). Next tick, move diagonally down `(x+dx, y+1)` if that cell is free, otherwise sideways `(x+dx, y)`. |
| Spring | player | `U`, `UL`, `UR` | Solid. Launches when the ball comes to rest on its top: either falling onto it, or rolling into the cell directly above it. A ball hitting its side treats it as a wall. `U` gives `flyQueue=[(0,-1)×3]`. `UR` gives `[(+1,-1),(+1,-1),(+1,0),(+1,0)]`, then `dx=+1`. `UL` is the mirror. |
| Fan | player | `L`, `R`, `U` | The fan body is **solid** (it acts as a wall and as a floor). Emits a beam starting in the adjacent cell, up to **3 cells** in its direction; the beam stops at solid cells. A ball inside an `L` or `R` beam gets `dx` set to the fan direction. A ball inside a `U` beam moves up 1 instead of falling and returns to `fall` when it exits the beam. |
| Bumper | player | `L`, `R` (deflect side) | Solid. If the ball moves into it horizontally, `dx = -dx` and it hops up one cell (`flyQueue=[(newDx,-1)]`). If the ball hits it from above, set `dx` to the bumper's deflect side and hop. |
| Conveyor *(stretch)* | player | `L`, `R` | Solid. A ball resting or rolling on its top has `dx` forced to the belt direction. |
| Switch | level | — | Passable. The first time the ball enters, it toggles every linked gate. |
| Gate | level | starts open or closed | Solid when closed, passable when open. |
| Checkpoint | level | numbered `1..n` | Passable. Only in-order hits count (see 4.7). |
| Target | level | `basket` or `bell` (cosmetic) | For `DELIVER`, entering it means success. For `CHECKPOINTS_THEN_DELIVER`, entering it means success **only if** all required checkpoints are already complete in order. Otherwise the target cell is passable and the ball carries on. |
| Start | level | initial `dx` | The ball spawns here in `fall` mode. |

### 4.5 Tick order (per tick)
1. **Fly:** if `mode === 'fly'`, pop the next offset and try to move. If the target cell is blocked, apply that cell's contact rule (for example a bumper) or switch to `fall`. When the queue empties, switch to `fall`.
2. **Fans:** apply the influence of any fan beam that contains the ball.
3. **Fall:** if the cell below is passable, move down. Otherwise land: switch to `roll` and fire the surface's landing rule (spring launch, conveyor `dx`).
4. **Roll:** if the cell below is passable, switch to `fall`. Else if `dx === 0`, increment a stall counter. Else try `(x+dx, y)`: solid walls stop the ball (`dx=0`), bumpers bounce it, ramps deflect it.
5. **Triggers:** apply switch, checkpoint and target effects for the cell the ball now occupies.
6. **Record:** append a frame `{x, y, mode}` and any events.

**Termination:**
- `success`: the ball entered the target.
- `lost`: the ball left the grid.
- `stalled`: 3 consecutive ticks without movement.
- `loop`: an identical state repeated. Hash `x, y, dx, mode, flyQueue, gate states, set of fired switches, set of checkpoints hit`. Fired switches matter because a fired switch won't toggle again. Checkpoints don't affect motion, but they are included so the hash covers the full state. In the UI, label this one *"Perpetual motion achieved"*.
- `timeout`: tick cap of 300.

### 4.6 Ball variants (public list; two are secretly chosen per Day)

| Id | Name | Effect |
|---|---|---|
| `OFFSET_L` | Drifter (left) | Spawns 1 column left of Start (clamped to the grid) |
| `OFFSET_R` | Drifter (right) | Spawns 1 column right of Start |
| `HEAVY` | Heavy | Fan beam range −2 (minimum 1); springs launch one cell lower |
| `BOUNCY` | Bouncy | Bumper hop +1; springs launch one cell higher |
| `REVERSE` | Contrarian | Initial `dx` is flipped |
| `SLICK` | Slick | Ignores conveyors; ramps deflect it sideways only (no diagonal drop) |

The how-to-play screen lists all six, so players can design for robustness. Which two appear stays secret until the reveal.

### 4.7 Progress score (for the do-no-harm rule and awards)
Compare these tuples lexicographically, higher is better:
```
P = [ delivered ? 1 : 0,
      checkpointsHitInOrder,
      -minBfsDistanceToTarget ]
```
**Distance field.** 4-connected BFS from the target over the **level's fixed geometry only**. Walls and floors are blocked. Gates are treated as passable whatever their state. **Player pieces are ignored.** Unreachable cells score 999. The field is constant for the whole Day. This is deliberate: if player pieces were included, a dormant piece that the ball never touches could block the BFS path, raise the distance, and be rejected even though the run didn't change. `minBfsDistanceToTarget` is the minimum field value over every cell the ball visited.

**Explicit decisions:**
- `checkpointsHitInOrder` is the longest correctly ordered prefix. Keep `next = 1`; when the ball enters checkpoint `n` and `n === next`, increment `next`; ignore every other checkpoint hit. The value is `next - 1`. So hitting ③ before ② gives no credit for ③ unless it is hit again after ②.
- `delivered` means objective success as defined in the 4.4 Target row.
- How the run ends (`lost`, `stalled`, `loop`, `timeout`) does not enter `P` except through `delivered`. A run that stalls next to the target and a run that falls into the void from the same spot are equal.
- Do **not** include ticks in `P`; a slower route that does just as well is allowed.
- Distance is a tiebreaker only. It decides nothing unless `delivered` and `checkpointsHitInOrder` are equal.

**Verdict text is built from events, never from the tuple.** For example: *"Ball 1 now falls into the void at E9 instead of reaching checkpoint ②."*

### 4.8 Output
```ts
interface SimResult {
  end: 'success' | 'lost' | 'stalled' | 'loop' | 'timeout';
  ticks: number;
  frames: { x: number; y: number; mode: Mode }[];
  events: {
    tick: number;
    kind: 'touch' | 'launch' | 'deflect' | 'switch' | 'checkpoint' | 'gate' | 'end';
    cell: [number, number];
    pieceId?: string;
  }[];
  progress: [number, number, number];
  touchedPieceIds: string[];
}
```
Also export `runDay(board, seed) -> { balls: [SimResult, SimResult, SimResult], score, awards }`. It is used by resolve and by the replay screen.

### 4.9 Determinism helpers (`src/shared`)
- `rng.ts`: mulberry32, seeded from a 32-bit hash of `dayId + secret`.
- `sha256.ts`: a small pure-TS implementation, so it works the same in the browser, the Devvit server and tests.
- `day.ts`: Day id = `YYYY-MM-DD` of the opening time in UTC, plus a day number.

### 4.10 Resolved edge cases (implement exactly; each gets a test in `sim.edgecases.test.ts`)
1. **Sockets** are a flag on an *empty* cell in the level grid, not a separate layer. A placed piece occupies that cell. Levels may not put sockets on non-empty cells, Start, Target, Switch, Gate or Checkpoint cells.
2. **Each ball runs independently from the initial board.** Gates start in their authored state for every ball. Nothing carries over between Balls 1, 2 and 3.
3. **Switches** fire once per ball run: on the first entry they toggle every linked gate. Later entries in the same run do nothing.
4. **Gates** keep whatever state they were toggled to for the rest of that ball's run.
5. A **flight step into a closed gate** (or any solid) is a blocked move: apply that cell's contact rule if it has one (bumper), otherwise switch to `fall` from the current cell.
6. **A gate closing on the ball's own cell** is impossible by construction (gates only toggle when the ball enters a switch cell, and switch cells can't be gates). The level validator rejects levels where a gate and its switch share a cell.
7. **Bumper hit from above while falling:** set `dx` to the bumper's deflect side, then hop (`flyQueue=[(dx,-1)]`). If the hop cell is blocked, skip the hop and keep falling from beside the bumper if that cell is free; otherwise stall.
8. **Bumper hop blocked** after a horizontal hit: reverse `dx`, no hop.
9. **Fan beams** pass through passable cells (ramps, switches, checkpoints, open gates) and stop at the first solid cell.
   - Overlapping horizontal beams: the nearest fan wins.
   - Ties: the fan with the lower `y`, then the lower `x`.
   - A `U` beam and a horizontal beam can both apply in the same tick: set `dx`, then lift.
10. **A diagonal move** (ramp or flight) succeeds if the destination cell is passable, even when both orthogonal neighbours are solid. There is no corner-cut check; keep it simple and consistent.
11. **Entering the Target by any move** (fall, roll, diagonal, flight) means `success` immediately.
12. **Spawn:** the Start cell must be empty and is never a socket. Drifter variants spawn one column over; if that cell is solid, spawn at Start instead.
13. The **stall counter** resets on any movement, including a launch or a fan lift.
14. **Several `U` beams** containing the ball lift it by exactly 1 per tick. Lift is not additive, so no priority rule is needed. (Only `U` fans make vertical beams; there are no downward fans.)
15. **Springs chain.** If a launch lands the ball on another spring's top, that spring launches it on landing. Each launch uses up its landing tick. The loop detector catches infinite chains.
16. **A target reached too early** (before the checkpoints are complete in `CHECKPOINTS_THEN_DELIVER`) is passable. The ball continues, and may come back later.

---

## 5. Daily machines: the procedural generator (`src/shared/generator`)

There is no hand-authored content catalogue. Every Day's machine is generated, comes with a known solution, is validated, and is stored before the Day opens.

### 5.1 Machine format (generator output; fixtures use the same format)
```jsonc
{
  "name": "Fan Corridor",                       // from the dominant band family
  "objective": { "type": "DELIVER" },           // or { "type": "CHECKPOINTS_THEN_DELIVER", "count": 2 }
  "rows": [ "....S....", "#######..", "..." ],  // 14 rows × 9 chars
  // legend: . empty  # solid  S start  T target  1-9 checkpoint
  //         w switch  G gate (closed)  g gate (open)  o socket
  "start": { "dx": 1 },
  "links": [{ "switch": "D6", "gates": ["G9"] }],
  "inventory": { "RAMP": 3, "SPRING": 2, "FAN": 2, "BUMPER": 2 },
  "solution": [ { "socket": "C4", "type": "RAMP", "dir": "DR" } ],   // NEVER sent to clients
  "gen": { "baseSeed": 123, "attempt": 4, "version": 1, "tier": 2, "families": ["drop", "gap", "fan"] }
}
```

### 5.2 Construction: build the solved machine, then break it
The 14-row board is a vertical stack of **3–4 bands**, each 3–5 rows tall. The ball flows top to bottom through each band. Each band is an instance of a parameterised **family**:

| Family | What's broken | Typical solution piece |
|---|---|---|
| Drop and redirect | The ball lands on a ledge heading the wrong way | Ramp or bumper |
| Gap | The ledge ends before a gap; a landing ledge sits across it | Spring (`UL`/`UR`) or fan (`L`/`R`) |
| Gate and switch | A closed gate blocks the route; the switch is off the natural path | Ramp or bumper that routes the ball through the switch |
| Launch pad | The exit is above the ball's ledge | Spring `U` or fan `U` |
| Fan corridor | A horizontal channel where the ball stalls | Fan `L`/`R` |
| Funnel | Nothing; a connector band of walls and drops | — |

**Algorithm** (pure and deterministic; all randomness comes from the seeded RNG):
1. **Choose.** Pick the tier (5.4), band count, families and parameters.
   - No family twice in a row.
   - Every band except funnels needs at least one fix.
   - Tier rules decide how many fixes in total.
2. **Construct forward.** Spawn the ball at the top. For each band:
   - lay terrain from the template using the ball's entry state (column, `dx`, mode);
   - place that band's solution piece(s);
   - simulate until the ball exits the band's bottom edge, and record the exit state as the next band's entry.
   - If a band doesn't exit cleanly within 60 ticks, re-roll its parameters (up to 20 tries), then re-roll the whole machine.
3. **Place the target where the solved ball ends up** at the bottom. Solvability holds by construction. For `CHECKPOINTS_THEN_DELIVER`, place checkpoints on cells the solved path visits, in path order, spread across different bands.
4. **Break it.** Remove every solution piece; those cells become sockets. Then add **decoy sockets** on empty cells within 2 cells of the solved path, for 10–14 sockets in total. Decoys never go on Start, Target, Switch, Gate or Checkpoint cells, or directly in the falling column above the Start.
5. **Inventory** = the solution's pieces plus tier-dependent extras, so the stock counts don't give away the answer.

**No general solver.** The solution is known because it was built. Validation only needs the bounded checks in 5.3, all of which are cheap simulation runs.

### 5.3 Validation (every machine must pass every check, or the attempt is rejected)

| Check | Requirement |
|---|---|
| Structural | 9 × 14 grid, valid legend, sockets only on empty cells, the gate and switch rules from 4.10, Start and Target present, Target reachable in the fixed-geometry distance field |
| Broken at start | With no player pieces, Ball 1 does not deliver |
| Interesting failure | With no player pieces, Ball 1 moves for at least 6 ticks before ending (no instant drop into the void) |
| Solvable | The stored solution delivers Ball 1 |
| Buildable under the rules | At least one order of placing the solution pieces exists in which every step satisfies `P(after) >= P(before)`. Check all orders (at most 4! = 24). |
| No trivial fix | Count the single-piece placements (every socket × type × orientation) that deliver Ball 1 on their own: tier 1 allows at most 1, tiers 2–3 allow 0. |
| Secret-ball headroom | The stored solution delivers between 1 and 4 of the 6 variants. Then 3/3 requires going beyond the known solution, but isn't hopeless. |
| Variety | The family sequence differs from each of the previous 2 Days, and the Start column differs from yesterday's |
| Budget | At most 5,000 sims per generated Day. Sims are tiny; this just bounds runtime. |

- On rejection, the next attempt uses seed `hash(baseSeed, attempt)`, up to 200 attempts.
- If every attempt fails, publish the next fallback fixture (5.6) and log loudly.
- **Never publish an unvalidated machine. Never fail to publish.**

### 5.4 Difficulty: a weekly rhythm
The tier comes from the weekday of the Day's open date (UTC), a recognisable weekly ritual:
- Mon/Tue: tier 1
- Wed/Thu: tier 2
- Fri: tier 3
- Sat: tier 3 with `CHECKPOINTS_THEN_DELIVER`
- Sun: tier 2, weighted towards the spring and fan families

What each tier controls:

| | Tier 1 | Tier 2 | Tier 3 |
|---|---|---|---|
| Solution size | 2 pieces | 3 pieces | 4 pieces |
| Decoy sockets | 6–7 | 7–9 | 8–10 |
| Extra inventory | +1 per type | +1–2 per type | +2 per type |
| Gate band | optional | likely | required |

Show the tier as 1–3 gear icons on the splash and HUD.

### 5.5 Determinism, storage and versioning
- `baseSeed = hash32(installSalt, dayNumber, GENERATOR_VERSION)`. `installSalt` is generated once at install and stored in `ce:cfg`.
- The generator is pure shared code and runs on the server during the cron tick.
- **Generate ahead.** Whenever a tick runs, make sure the machines for the next 2 Days exist in `ce:level:{dayNumber}`. `HANDED_OFF` only *reads* a stored machine; generation is never on the critical path.
- Store the full machine JSON including `gen` metadata. Each Day reads its machine from storage, so generator updates never change past or already-generated machines.
- Bump `GENERATOR_VERSION` whenever generator output could change. The mod menu item **Regenerate upcoming** clears unpinned future machines so they regenerate with the new version.
- **The `solution` field is stripped from every API response.** Tests enforce this. Mod-only menu item **Show today's solution** displays it in a toast, for debugging.

### 5.6 Fixtures (`src/shared/fixtures`)
Five hand-built machines in the same format. They serve two purposes:
1. Golden simulation tests, written in Phase 1 before the generator exists.
2. Emergency fallback if generation fails.

They are not a content catalogue.

### 5.7 Curation for the judging window (optional, about 15 minutes, once)
- The harness has a **seed gallery**: thumbnails of the next 30 generated Days with tier and families, plus a **Play solution** button for each.
- For any Day you can pin a different validated attempt (`ce:pin:{dayNumber}` → attempt number).
- Use it once before judging so the machines live during judging are strong ones.
- Curation only picks between generated machines. It never edits one.

## 6. Architecture

### 6.1 Stack
- **Devvit Web** (start from the official current Devvit Web template; verify API names against `developers.reddit.com/docs` before writing integration code, because templates change).
- **Server:** Hono (or whatever server framework the current template uses), TypeScript, bundled to a single CJS file by the Devvit Vite plugin.
- **Client:**
  - `splash.html`: inline post entry. Plain TypeScript, HTML and CSS. **Must not load Phaser.** It should be light and fast in the feed.
  - `game.html`: expanded entry, opened with `requestExpandedMode`. Phaser 3 renders the board and animation. A thin DOM overlay in vanilla TypeScript handles the HUD, bottom sheets and modals (DOM is easier than Phaser for mobile UI). No React.
- **Persistence:** Devvit Redis. Use hashes, sorted sets and strings only; check which commands Devvit currently supports before using anything else.
- **Scheduler:** a cron task for the daily resolve-and-open job.
- **Realtime (optional):** publish a `board_changed` message on a per-post channel after each placement; the client refetches. Fallback: poll `/api/state` every 15 seconds while the game is visible.
- **Tests:** Vitest.

### 6.2 Repo layout
```
src/
  shared/            # pure, platform-free; imported by client, server, tests
    sim/             # engine, pieces, variants, progress, runDay
    generator/       # bands.ts construct.ts validate.ts difficulty.ts seed.ts generate.ts
    fixtures/        # 5 hand-built machines: golden tests + emergency fallback
    rules/           # placement validation (uses sim)
    awards.ts  rng.ts  sha256.ts  day.ts  types.ts  protocol.ts  coords.ts
  server/
    index.ts         # app bootstrap
    routes/api.ts    # /api/*
    routes/internal.ts  # /internal/cron/*, /internal/menu/*, /internal/forms/*
    core/
      keys.ts        # every Redis key in one place
      state.ts       # read Day state
      placement.ts   # transactional place/move/remove
      predict.ts
      resolve.ts     # lock + runDay + awards + stats + results comment
      posts.ts       # create daily post, results comment
      seed.ts        # demo seeding
  client/
    splash/  splash.html  splash.ts  splash.css
    game/    game.html  main.ts
             scenes/BoardScene.ts  scenes/RunScene.ts
             ui/hud.ts  ui/palette.ts  ui/modals.ts  ui/coach.ts
    lib/api.ts       # typed fetch to /api/*
dev/
  harness/           # local mock server + in-memory Redis stub + static client host
tests/
DECISIONS.md         # log of design decisions made during the build
README.md            # player-facing; required by the hackathon
devvit.json
```

### 6.3 Redis keys (`server/core/keys.ts`)
```
ce:cfg                              hash   installSalt, resolveHourUtc, generatorVersion
ce:level:{dayNumber}                string machine JSON incl. solution + gen metadata (solution never sent to clients)
ce:pin:{dayNumber}                  string pinned generator attempt (curation)
ce:dupes                            zset   duplicate Reddit posts/comments awaiting mod cleanup
ce:day:current                      string dayId
ce:day:{dayId}:meta                 hash   levelId, status (CREATING|OPEN|LOCKED|RESOLVED|COMMENTED|HANDED_OFF),
                                           openedAt, locksAt, lockedAt, postId, postAttemptAt,
                                           commitHash, resultsCommentId, commentAttemptAt, nextDayId
ce:lock:daily                       string lease token for the cron tick (set-if-absent, ~5 min expiry)
ce:day:{dayId}:secret               string secret (never returned by any API while OPEN)
ce:day:{dayId}:pieces               hash   socketId -> JSON {pieceId,type,dir,userId,username,placedAt,editedAt,replaced?:{userId,type}}
ce:day:{dayId}:inv                  hash   type -> remaining
ce:day:{dayId}:holder               hash   userId -> socketId   (who currently holds a piece)
ce:day:{dayId}:pred                 hash   userId -> 0..3
ce:day:{dayId}:events               zset   score=ts, member=JSON (placements/replacements, for reports & "Clutch")
ce:day:{dayId}:result               string JSON {score, perBall:[end,progress], awards, revealedSecret}
ce:post:{postId}                    string dayId
ce:user:{userId}:stats              hash   placed, touchedInFinal, mvps, predStreak, predBest, lastSeenTs
ce:user:{userId}:inbox              zset   score=ts, member=JSON report items
ce:sub:stats                        hash   streak, bestStreak, perfectDays, totalDays
ce:lb:mvps                          zset   userId -> mvp count
```

**Namespacing:** Devvit Redis is expected to be isolated per app installation, i.e. per subreddit. Verify this in the docs during Phase 0. If it is not isolated, prefix every key with the subreddit id.

### 6.4 API (`/api/*`, all JSON, server-authoritative)
- `GET /api/state?postId=` returns:
  - `day`: meta, status, commitHash, locksAt
  - `level`
  - `pieces`, `inventory`
  - `me`: `{ userId, username, socket?, prediction?, inbox[] }`
  - `counts`: builders, predictors, prediction histogram (hidden until resolved)
  - `result` (if RESOLVED, including the revealed secret)
  - `sub` stats
- `POST /api/place {postId, socketId, type, dir}` handles every row of the 2.5 action matrix; the server infers the action. It is **one logical transaction**:
  1. `WATCH` the Day `meta` (status), `pieces`, `inv` and `holder`.
  2. Read them and validate status, ownership, stock (in the 2.5 accounting order) and `P`, by re-running the sim server-side.
  3. In a single `MULTI`, write `pieces`, `inv`, `holder`, the `events` entry, the displaced player's `inbox` entry, and user stats.
  4. `EXEC`. If it aborts, re-read and retry (up to 5 times), then return *"Busy machine, try again."*
  - Partial updates are never acceptable. Check in Phase 0 that Devvit's `watch/multi/exec` covers hashes and sorted sets in one transaction. If it doesn't, merge `pieces`, `holder` and `inv` into a single per-Day hash, and make `events` and `inbox` writes idempotent follow-ups keyed by a placement id stored inside that hash, retried until they succeed.
  - Returns the new state, or `{error, message}`.
- `POST /api/remove {postId}` removes your own piece (the matrix's Remove row).
- `POST /api/predict {postId, balls}`.
- `POST /api/inbox/ack {postId}` marks report items as seen.

Internal endpoints:
- `POST /internal/cron/tick` runs every 10 minutes, takes the lease lock and advances the daily pipeline from section 2.1. Each stage is idempotent and resumable.
- Mod menu items:
  - **Chaos Engine: Seed demo day**: fills the current Day with labelled setup pieces and fake predictions.
  - **Run now**: resolve immediately and open the next Day.
  - **New post for today**: recreate the post if it was deleted.
  - **Remove piece…**: a form to remove a piece by coordinate (moderation override).
  - **Regenerate upcoming**, **Show today's solution** (mod-only), **Show duplicates**.
- Trigger: on app install, open Day 1 and create its post.

### 6.5 Local harness (`dev/harness`), required before any Reddit work
- A small Node server that mounts the same route handlers against an **in-memory Redis stub** that implements the subset of commands used, including `watch/multi/exec` semantics.
- It serves the built `splash.html` and `game.html` and fakes the Devvit context: a user switcher (u/alice, u/bob, …), plus `requestExpandedMode` that just navigates to `game.html`.
- Dev-only controls: **Advance day** (calls the cron handler), **Seed demo**, **Switch user**.
- `npm run harness` builds with `vite build --watch` and starts the harness. Keep it light.
- The client's `lib/api.ts` must not know it's in the harness.

---

## 7. UX and screens

### 7.1 Splash (inline in the feed)
- **OPEN Day:**
  - A mini static render of today's machine. Draw it with a small canvas or SVG routine, not Phaser.
  - Level name and goal icon.
  - Countdown to lock.
  - "N engineers · M/12 sockets filled".
  - Ball 1 status chip: *"Right now: Ball 1 stalls at E9"* or *"Right now: Ball 1 delivers ✓"*.
  - Yesterday's result chip: *"Yesterday: 2/3 delivered"*.
  - Primary CTA: **Build**.
- **RESOLVED Day:** the big score (*"2 / 3 delivered"*), the revealed variant names, MVP username, and a CTA **Watch the run**.
- It must look good in both light and dark Reddit themes.

### 7.2 Game (expanded), portrait layout
- **Top HUD:** level name and goal, lock countdown, sealed-hash chip (tap it for an explanation), builder count, and a "?" button for how to play.
- **Board:** about 70% of the height. Column and row labels on the edges. Sockets show as dashed outlines. Tapping a piece opens a card showing who placed it, type, orientation, when, whether it was edited, and *"replaced u/x's bumper"* if applicable.
- **Bottom bar:**
  - **▶ Test run** (Ball 1, with a speed toggle of 1×, 2× or 4×)
  - **Place / Move my piece**
  - **Predict**
- **Placement flow:**
  1. Tap an empty or replaceable socket.
  2. A bottom sheet opens with the palette and stock counts.
  3. Pick a piece and tap to rotate. A **ghost preview** runs automatically, showing the old path faded and the new path bright.
  4. The verdict appears immediately: *"Better progress ✓"*, *"Same progress ✓"*, or *"Lower progress ✗: stops at E9 instead of reaching ①"*.
  5. **Confirm**.
  6. Invalid actions are always explained, never silently rejected.
- **First open:** a coach overlay of three steps, which must take under 10 seconds:
  1. "This machine is broken. Run it."
  2. "Add one piece to help."
  3. "At lock, three balls fire. Two are secret."

### 7.3 Run screen (RESOLVED Days), the payoff; spend the polish budget here
1. **Reveal:** the secret unseals with an animation, the hash check shows, and the two variant cards flip over (*"Ball 2: HEAVY · Ball 3: DRIFTER (LEFT)"*).
2. **Three runs in sequence**, each with a clear label. The camera follows the ball. Slow motion triggers on key events: the first touch of each player piece, gates opening, near misses within 1 cell of the target, and the end. Each touched piece briefly shows its owner's username.
3. **Tally** the score with a celebration, or show a funny failure title: *"Lost to the void"*, *"Perpetual motion achieved"*, *"Stalled at C9"*.
4. **Awards** cards: MVP, Most Touched, Clutch.
5. **Your results:** your piece's contribution, your prediction (right or wrong), and community streak changes.
6. A **"Build today's machine →"** button that navigates to the newest post.
- Controls: replay, choose ball 1/2/3, speed, and a **Jump to key moment** chip list.

### 7.4 Visual direction
- A miniature mechanical workshop look: warm off-white board surface, strong blue, orange and yellow accents, dark outlines, rounded chunky pieces, soft shadows.
- The board sits on its own surface, so it reads well inside both Reddit themes.
- Every piece must show its orientation clearly at 38 px.

### 7.5 Animation (procedural, no sprite sheets)
- **Ball:** eased tween between cells at about 120 ms per tick at 1×. Spring launches follow a smooth arc through the queued cells. Squash on landing. A short motion trail.
- **Spring:** compresses and expands. **Fan:** blades spin, and the beam shows faint particles. **Bumper:** flashes and pops in scale. **Gate:** slides. **Switch:** flips. **Target:** confetti for a basket, a ring wave for a bell.
- **Failure:** a puff and gentle shake on `lost`, a wobble on `stalled`, a spinning loop icon on `loop`.
- **Sound:** optional and off until first tap (mobile webviews need a user gesture). Short procedural blips are enough.

### 7.6 Mobile and accessibility
- Design for 360 × 640 first.
- Tap targets at least 44 px.
- No hover-only interactions.
- Text at least 14 px.
- Never rely on colour alone to show validity; always pair it with an icon and text.

---

## 8. Reddit integration ("Reddity" score)

- **Daily post title:** `Chaos Engine · Day 12 · Ring the Bell` (the `Chaos Engine · Day N` part is the recovery marker from 2.1; never change its format).
- **Results comment** posted by the app on the resolved post. Make it sticky if the API allows. Example:
  > ⚙️ **2/3 delivered.** Ball 2 (HEAVY) fell short at G11.
  > 🏆 MVP: u/kestrel's spring at F4 · 👆 Most Touched: u/moss's ramp at C3 · ⏱ Clutch: u/plover, 14 min before lock.
  > 🔮 31% predicted 2. Streak: 4 days. Tomorrow's machine is up →
- **Coordinates everywhere** (C7, F4) so comment threads can talk about specific spots.
- **Stretch goals,** in order (only after Phase 6 passes; verify each API exists first):
  1. MVP user flair (*"⚙️ Chief Engineer"*).
  2. Snoovatar shown on piece cards.
  3. A "Share my piece" button that posts a comment as the user with explicit consent (*"I put a spring at F4. Fight me."*).

---

## 9. Testing (Vitest)

- `sim.pieces.test.ts`: each piece and orientation in a minimal grid (ramp deflect, spring arcs, fan beam range and blocking, bumper from side and from above, gates, switches).
- `sim.termination.test.ts`: success, lost, stalled, loop detection, timeout.
- `sim.determinism.test.ts`: the same input gives identical `SimResult` (deep equal) across 1,000 runs. **Golden snapshots** of full runs for the 5 fixtures.
- `variants.test.ts`: each variant's effect, and that seed selection is stable and always picks 2 distinct variants.
- `progress.test.ts`: tuple ordering and the BFS distance field.
- `rules.test.ts`: every row of the 2.5 action matrix; stock is returned before it is taken (moving or swapping with zero stock left works); the one-piece invariant holds after every action.
- `generator.test.ts`:
  - The same seed produces a byte-identical machine.
  - 100 consecutive day numbers all produce validated machines within the attempt limit (log the median attempt count).
  - Each check in 5.3 has a test with a crafted failing case.
  - Generating one Day stays within the sim budget.
- `fixtures.test.ts`: every fixture passes 5.3 (except the variety check).
- `api.secrets.test.ts`: neither `solution` nor the Day secret appears in any API response while OPEN.
- `placement.tx.test.ts`: two concurrent places on the same socket, where exactly one wins; inventory never goes negative; the one-piece-per-user invariant holds under races.
- `resolve.test.ts`: idempotent (running twice changes nothing), awards are correct on crafted boards, stats and streak update correctly, the secret is revealed only after resolve.
- `pipeline.recovery.test.ts`:
  - Inject a failure after each stage, then re-run the tick. It must reach `HANDED_OFF` with exactly one results comment and exactly one next post.
  - Two overlapping ticks: only one advances (lease lock).
  - A placement racing the lock is either accepted before `LOCKED` or refused; it is never applied after.
- `sim.edgecases.test.ts`: one test per item in section 4.10 (16 items).
- `progress.test.ts` additionally: longest-ordered-prefix checkpoint counting, and a target reached before the checkpoints are complete does not count as delivered.
- `progress.test.ts` additionally: a dormant piece that blocks a BFS route does **not** change `P`.
- `api.test.ts`: every endpoint against the Redis stub, including that the secret never leaks while OPEN.
- `npm run check` runs lint, type-check, tests and build. CI runs the same steps on push.

---

## 10. Build phases and exit gates

Target dates assume starting Nov 22. Days 15–17 are buffer and submission; protect them.

### Phase 0: Scaffold (Day 1)
- Devvit Web template, TypeScript strict, Vitest, ESLint, the repo layout from 6.2, an empty harness, `DECISIONS.md`.
- **Gate:** `npm run check` passes; the harness serves a placeholder game page.

### Phase 1: The simulation is fun (Days 1–3)
- The shared sim (all of section 4), the 5 fixtures (5.6), and the full test suite for sim, progress and variants.
- A minimal Phaser BoardScene in the harness that renders a machine, lets you drop pieces freely (sandbox, no rules yet), and plays a test run with proper tweens.
- **Gate:** determinism and golden tests pass, **and** watching a run is genuinely satisfying. Tune timings and piece behaviours **now**. The generator is built on these numbers, so changing them later means re-tuning it.

### Phase 2: The generator (Days 3–6)
- All of section 5: band families, forward construction, breaking, validation, tiers, generate-ahead and versioning, plus the generator tests.
- A harness **seed gallery** (5.7): thumbnails of upcoming Days and a Play solution button.
- **Gate:**
  - 100 consecutive day numbers each produce a validated machine within 200 attempts.
  - Generating one Day takes under 2 seconds in the harness.
  - In the gallery, at least 8 of 10 random machines look like real contraptions, not noise.
  - If machines look samey or random, fix the band templates before moving on. Do not add families to compensate.

### Phase 3: The full day loop runs locally (Days 6–8)
- Server core: keys, state, transactional placement with the 2.5 rules, predict, resolve with awards and stats, the daily cron handler (including generate-ahead), inbox reports, and the seed tool.
- Client: HUD, palette sheet with ghost preview and verdicts, piece cards, predict sheet, report modal, coach overlay.
- Harness: user switcher and Advance day.
- **Gate:** the pipeline recovery tests pass, **and** in the harness three fake users can build, predict and advance the day. The run screen shows a correct score and awards. Replaced users can place again. Every API test passes.

### Phase 4: The payoff and the splash (Days 8–10)
- The full section 7.3 run screen (reveal, three runs, slow-mo, tally, awards, your results).
- The splash for both states.
- Animation polish (7.5), and light/dark checks.
- **Gate:** a 20-second screen capture of a resolve-and-reveal looks good enough to open the demo video.

### Phase 5: Devvit integration (Days 10–12; needs a working Reddit account)
- `devvit.json`:
  - splash as the inline entry, game as the expanded entry
  - scheduler task, menu items, install trigger
  - realtime if used
  - an **empty** HTTP fetch allowlist (no external services)
- `devvit login` and `devvit playtest` on the dev subreddit. Verify on **Reddit mobile app and desktop web**.
- Results comment and daily post creation working.
- Create the test subreddit early and post something normal in it before installing the app. A previous entrant reported that new hackathon subreddits were auto-banned by Reddit's safety automation, with a manual unban through the Devpost forum. Leave time for that round trip.
- **Gate:** the cron job (triggered via **Run now**) resolves a Day, comments, and opens the next post with a freshly generated machine on real Reddit. A second account can place and predict.

### Phase 6: Judge path (Days 12–14)
- Use the seed gallery to check, and if needed pin, the machines for the Days that will be live during judging (5.7).
- Seed the demo subreddit so that at judging time it has:
  - at least one **RESOLVED** post with a dramatic run (ideally 2/3 with a near miss)
  - one **OPEN** post with labelled setup pieces, where Ball 1 visibly fails, so a judge can fix it with one more piece
- Make the subreddit public with fewer than 200 members, or install `dr-admin-approve`.
- **Gate:** a fresh account, with no instructions, can understand the game and make a valid placement within 30 seconds on mobile.

### Phase 7: Submission (Days 15–17)
- `README.md` (player-facing): what it is, how to play, the rules table, the variant list, how fairness works (the hash), screenshots, and moderator menu docs.
- **Demo video under 60 seconds,** recorded on a phone in the Reddit app:
  - 0–8 s: the reveal and three balls firing on a resolved machine (hook first)
  - 8–30 s: building, with a test run, ghost preview, "Better ✓" verdict and placing
  - 30–45 s: predictions, a piece card showing the username, and the results comment in the Reddit thread
  - 45–60 s: "a new machine generated every day" with a montage of 3 generated machines
- Devpost text that leads with the differentiators: one cooperative machine, secret balls with a provable seal, no-grief rules without voting, and a new machine generated and proven solvable every day.
- Fill in the app listing link, test subreddit link, demo post link and repo link. Complete the optional feedback survey (a separate small prize).
- **Gate:** every required link works from a logged-out browser.

---

## 11. Working instructions for Claude Code

1. Follow the phases in order and check the exit gate before moving on. If a gate fails, fix it before continuing.
2. `src/shared` stays pure: no DOM, no network, no `Date.now()`, no `Math.random()`, no floats in state. Lint rules should enforce this where possible.
3. The server is authoritative. The client sim exists only for previews and replays. The server re-runs the sim on every placement and at resolve. Never trust client-reported results.
4. Any behaviour change to the sim must update the golden snapshots in the same commit, with a note in `DECISIONS.md`.
5. Verify Devvit API names, `devvit.json` schema and supported Redis commands against the current docs before Phase 5 code. Don't rely on memory.
6. Keep bundles lean. The splash must not import Phaser. Check bundle sizes after each phase.
7. Every user-facing error must be a specific human sentence. Never show raw error codes.
8. Keep `README.md` current at the end of each phase. It's a required submission artefact.
9. The generator is built on the sim. Whenever sim behaviour changes, re-run the 100-seed generator gate and check the seed gallery.
10. When a design question isn't answered here, choose the option that is simplest to build and best for the judges' first 30 seconds, then log it in `DECISIONS.md`.
