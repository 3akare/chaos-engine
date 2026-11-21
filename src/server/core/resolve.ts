/** RESOLVED stage (§2.1, §2.6–2.9): run the frozen board, award, update stats and inboxes — one MULTI. */
import { computeAwards, type PieceMeta, type PlacementLog } from '../../shared/awards';
import { cellName } from '../../shared/coords';
import type { DayResult, InboxItem, StoredPiece } from '../../shared/protocol';
import { daySeed } from '../../shared/rng';
import { boardPieces, pieceName } from '../../shared/rules/placement';
import { levelOf } from '../../shared/sim/board';
import { runDay, type DayRun } from '../../shared/sim/runDay';
import { variantInfo } from '../../shared/sim/variants';
import type { Deps } from './deps';
import { encodeMeta, newId, parsePieces, readMachine, readMeta } from './day';
import { K } from './keys';
import type { PlacementLogEntry } from './placement';

/** Recompute a resolved Day's run deterministically (also used by tests and the comment). */
export async function recomputeRun(deps: Deps, dayId: string): Promise<{ run: DayRun; pieces: StoredPiece[] } | null> {
  const meta = await readMeta(deps.store, dayId);
  if (!meta) return null;
  const machine = await readMachine(deps.store, meta.dayNumber);
  const secret = await deps.store.get(K.secret(dayId));
  if (!machine || !secret) return null;
  const pieces = parsePieces(await deps.store.hGetAll(K.pieces(dayId)));
  const board = { level: levelOf(machine), pieces: boardPieces(pieces) };
  return { run: runDay(board, daySeed(dayId, secret)), pieces: Object.values(pieces) };
}

export function endCells(run: DayRun): string[] {
  return run.balls.map((b) => {
    const e = b.events.find((x) => x.kind === 'end');
    return e ? cellName(e.cell[0], e.cell[1]) : '?';
  });
}

export async function resolveDay(deps: Deps, dayId: string): Promise<boolean> {
  const { store } = deps;
  for (let attempt = 0; attempt < 3; attempt++) {
    const tx = await store.watch(K.meta(dayId));
    const meta = await readMeta(store, dayId);
    if (!meta || meta.status !== 'LOCKED') {
      await tx.unwatch();
      return meta?.status === 'RESOLVED';
    }
    const machine = await readMachine(store, meta.dayNumber);
    const secret = await store.get(K.secret(dayId));
    if (!machine || !secret) {
      await tx.unwatch();
      deps.log('error', `cannot resolve ${dayId}: missing ${machine ? 'secret' : 'machine'}`);
      return false;
    }
    const piecesMap = parsePieces(await store.hGetAll(K.pieces(dayId)));
    const pieces = Object.values(piecesMap);
    const board = { level: levelOf(machine), pieces: boardPieces(piecesMap) };
    const run = runDay(board, daySeed(dayId, secret));
    const lockedAt = meta.lockedAt ?? meta.locksAt;
    const pmeta: PieceMeta[] = pieces.map((p) => ({ id: p.pieceId, userId: p.userId, username: p.username, placedAt: p.placedAt, setup: p.setup === true }));
    const log: PlacementLog[] = (await store.zRange(K.events(dayId), 0, -1)).map((m) => {
      const e = JSON.parse(m.member) as PlacementLogEntry;
      return { pieceId: e.pieceId, userId: e.userId, username: e.username, at: e.at, raised: e.raised, setup: e.setup };
    });
    const awards = computeAwards(board, run, pmeta, log, lockedAt);

    const predH = await store.hGetAll(K.pred(dayId));
    const predictions: DayResult['predictions'] = [0, 0, 0, 0];
    for (const v of Object.values(predH)) {
      const n = Number(v);
      if (n >= 0 && n <= 3) predictions[n]!++;
    }
    const subH = await store.hGetAll(K.sub);
    const streak = run.score >= 1 ? Number(subH.streak ?? 0) + 1 : 0;
    const sub = {
      streak,
      bestStreak: Math.max(Number(subH.bestStreak ?? 0), streak),
      perfectDays: Number(subH.perfectDays ?? 0) + (run.score === 3 ? 1 : 0),
      totalDays: Number(subH.totalDays ?? 0) + 1,
    };
    const result: DayResult = {
      score: run.score,
      checkpoints: run.checkpoints,
      variants: run.variants,
      perBall: run.balls.map((b) => ({ variant: b.variant, end: b.end, progress: b.progress, ticks: b.ticks })) as DayResult['perBall'],
      awards,
      revealedSecret: secret,
      lockedAt,
      predictions,
      builders: new Set(pieces.filter((p) => !p.setup).map((p) => p.userId)).size,
      streak,
    };

    // Per-user effects.
    const now = deps.now();
    const inbox: Array<{ userId: string; item: InboxItem }> = [];
    const touchedBy = new Map<string, number[]>();
    run.balls.forEach((b, i) => {
      for (const id of b.touchedPieceIds) touchedBy.set(id, [...(touchedBy.get(id) ?? []), i]);
    });
    const ballName = (i: number): string => (i === 0 ? 'Ball 1' : `Ball ${i + 1} (${variantInfo(run.variants[i]!).short})`);
    const goal = machine.target === 'basket' ? 'into the basket' : 'into the bell';
    const touchedOwners = new Map<string, number>();
    for (const p of pieces) {
      if (p.setup) continue;
      const balls = touchedBy.get(p.pieceId) ?? [];
      if (balls.length) touchedOwners.set(p.userId, (touchedOwners.get(p.userId) ?? 0) + 1);
      const isMvp = awards.mvp?.pieceId === p.pieceId;
      const delivered = balls.find((i) => run.balls[i]!.end === 'success');
      let text: string;
      if (isMvp) {
        text = delivered !== undefined ? `Your ${pieceName(p.type)} at ${p.socket} helped ${ballName(delivered)} ${goal}. MVP!` : `Your ${pieceName(p.type)} at ${p.socket} was Day ${meta.dayNumber}'s MVP!`;
      } else if (balls.length) {
        text = `Your ${pieceName(p.type)} at ${p.socket} touched ${balls.length === 1 ? ballName(balls[0]!) : `${balls.length} of 3 balls`} on Day ${meta.dayNumber}. ${run.score}/3 delivered.`;
      } else {
        text = `Your ${pieceName(p.type)} at ${p.socket} stayed dormant on Day ${meta.dayNumber} — no ball touched it. ${run.score}/3 delivered.`;
      }
      inbox.push({ userId: p.userId, item: { id: newId(deps), at: now, kind: isMvp ? 'mvp' : 'touched', dayNumber: meta.dayNumber, text } });
    }
    const predStats: Array<{ userId: string; streak: number; best: number }> = [];
    for (const [uid, v] of Object.entries(predH)) {
      const h = await store.hGetAll(K.userStats(uid));
      const right = Number(v) === run.score;
      const s = right ? Number(h.predStreak ?? 0) + 1 : 0;
      predStats.push({ userId: uid, streak: s, best: Math.max(Number(h.predBest ?? 0), s) });
      if (!touchedOwners.has(uid) && !pieces.some((p) => p.userId === uid)) {
        inbox.push({
          userId: uid,
          item: { id: newId(deps), at: now, kind: 'prediction', dayNumber: meta.dayNumber, text: right ? `You predicted ${v} for Day ${meta.dayNumber} — exactly right! Prediction streak: ${s}.` : `You predicted ${v} for Day ${meta.dayNumber}; it was ${run.score}/3.` },
        });
      }
    }

    await tx.multi();
    await tx.set(K.result(dayId), JSON.stringify(result));
    await tx.hSet(K.meta(dayId), encodeMeta({ status: 'RESOLVED' }));
    await tx.hSet(K.sub, Object.fromEntries(Object.entries(sub).map(([k, v]) => [k, String(v)])));
    for (const [uid, n] of touchedOwners) await tx.hIncrBy(K.userStats(uid), 'touchedInFinal', n);
    if (awards.mvp) {
      await tx.hIncrBy(K.userStats(awards.mvp.userId), 'mvps', 1);
      await tx.zIncrBy(K.lbMvps, awards.mvp.userId, 1);
    }
    for (const p of predStats) await tx.hSet(K.userStats(p.userId), { predStreak: String(p.streak), predBest: String(p.best) });
    for (const { userId, item } of inbox) await tx.zAdd(K.inbox(userId), { member: JSON.stringify(item), score: now });
    if ((await tx.exec()) !== null) return true;
  }
  return false;
}
