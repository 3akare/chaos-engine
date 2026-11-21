/** Awards (§2.8): computed at resolve, deterministic, positive only. */
import type { Board } from './sim/board';
import { compareOutcome, runBalls, type DayRun, type Outcome } from './sim/runDay';

export type PieceMeta = {
  id: string;
  userId: string;
  username: string;
  placedAt: number;
  /** Setup pieces (seed/demo tool) never win awards. */
  setup: boolean;
};

export type Award = { pieceId: string; userId: string; username: string; value: number };
export type Awards = { mvp: Award | null; mostTouched: Award | null; clutch: (Award & { at: number }) | null };

/** A logged placement, used for Clutch. `raised` = it strictly raised P. */
export type PlacementLog = { pieceId: string; userId: string; username: string; at: number; raised: boolean; setup: boolean };

export function computeAwards(board: Board, run: DayRun, meta: readonly PieceMeta[], log: readonly PlacementLog[], lockedAt: number): Awards {
  const byId = new Map(meta.map((m) => [m.id, m]));
  const players = board.pieces
    .filter((p) => {
      const m = byId.get(p.id);
      return m !== undefined && !m.setup;
    })
    .sort((a, b) => byId.get(a.id)!.placedAt - byId.get(b.id)!.placedAt || (a.id < b.id ? -1 : 1));

  // MVP: largest drop in outcome when the piece is removed (counterfactual rerun).
  let mvp: Award | null = null;
  let best: Outcome | null = null;
  for (const p of players) {
    const without = runBalls(board, run.variants, board.pieces.filter((q) => q.id !== p.id));
    const drop: Outcome = [
      run.outcome[0] - without.outcome[0],
      run.outcome[1] - without.outcome[1],
      run.outcome[2] - without.outcome[2],
    ];
    if (compareOutcome(drop, [0, 0, 0]) <= 0) continue;
    if (best === null || compareOutcome(drop, best) > 0) {
      best = drop;
      const m = byId.get(p.id)!;
      mvp = { pieceId: p.id, userId: m.userId, username: m.username, value: drop[0] };
    }
  }

  // Most Touched: touch events across all three runs.
  const touches = new Map<string, number>();
  for (const b of run.balls) for (const e of b.events) if (e.kind === 'touch' && e.pieceId) touches.set(e.pieceId, (touches.get(e.pieceId) ?? 0) + 1);
  let mostTouched: Award | null = null;
  for (const p of players) {
    const n = touches.get(p.id) ?? 0;
    if (n > 0 && (mostTouched === null || n > mostTouched.value)) {
      const m = byId.get(p.id)!;
      mostTouched = { pieceId: p.id, userId: m.userId, username: m.username, value: n };
    }
  }

  // Clutch: the last placement before lock that strictly raised P.
  let clutch: Awards['clutch'] = null;
  for (const l of log) {
    if (!l.raised || l.setup || l.at > lockedAt) continue;
    if (clutch === null || l.at >= clutch.at) clutch = { pieceId: l.pieceId, userId: l.userId, username: l.username, value: lockedAt - l.at, at: l.at };
  }
  return { mvp, mostTouched, clutch };
}
