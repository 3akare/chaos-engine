/**
 * Today's leaderboard. A pour that would raise your best is re-run here with the same physics
 * the phone used, and the server's count is the one that goes on the board.
 */
import { buildKey, cleanBuild, parseBuildKey } from '../../shared/pour/build';
import { runPour } from '../../shared/pour/sim';
import { BALLS, type Machine, type Piece } from '../../shared/pour/types';
import { DEFAULT_CEILING, tierFor, tiersFor } from '../../shared/goal';
import type { ApiError, Entry, PourResult, Totals } from '../../shared/protocol';
import type { Deps } from './deps';
import { readMachine, readMeta } from './day';
import { K } from './keys';

export const BOARD_SHOWN = 10;
const COOLDOWN_MS = 2500;

export type BestRec = { u: string; s: number; at: number; b: string };

/** Higher is better: balls caught, then whoever got there first. */
export function rankScore(score: number, at: number, openedAt: number): number {
  const secs = Math.min(999_999_999, Math.max(0, Math.floor((at - openedAt) / 1000)));
  return score * 1e9 + (999_999_999 - secs);
}

export async function readBest(deps: Deps, dayId: string, userId: string): Promise<BestRec | null> {
  const raw = await deps.store.hGet(K.best(dayId), userId);
  return raw ? (JSON.parse(raw) as BestRec) : null;
}

export const bestBuild = (r: BestRec): Piece[] => parseBuildKey(r.b);

export async function topEntries(deps: Deps, dayId: string, n = BOARD_SHOWN): Promise<Entry[]> {
  const top = await deps.store.zRange(K.board(dayId), 0, n - 1, { reverse: true });
  const all = await deps.store.hGetAll(K.best(dayId));
  return top.map((m, i) => {
    const r = all[m.member] ? (JSON.parse(all[m.member]!) as BestRec) : null;
    return { rank: i + 1, username: r?.u ?? 'someone', score: r?.s ?? Math.floor(m.score / 1e9), at: r?.at ?? 0 };
  });
}

/** 1-based rank on today's board, or null if you haven't scored. */
export async function rankOf(deps: Deps, dayId: string, userId: string): Promise<number | null> {
  const asc = await deps.store.zRank(K.board(dayId), userId);
  if (asc === undefined) return null;
  return (await deps.store.zCard(K.board(dayId))) - asc;
}

/** Best score known for a machine: the goal tiers are measured against it. */
export const ceilingOf = (m: Machine | null): number => m?.gen?.goal ?? m?.gen?.best ?? DEFAULT_CEILING;

/** The day so far: each player counted once, with their best pour. */
export async function readTotals(deps: Deps, dayId: string, ceiling: number): Promise<Totals> {
  const [h, bests] = await Promise.all([deps.store.hGetAll(K.totals(dayId)), deps.store.hGetAll(K.best(dayId))]);
  const scores = Object.values(bests).map((raw) => (JSON.parse(raw) as BestRec).s);
  const players = scores.length;
  const balls = scores.reduce((a, s) => a + s, 0);
  const tiers = tiersFor(players, ceiling);
  return { players, pours: Number(h.pours ?? 0), balls, hundreds: Number(h.hundreds ?? 0), tiers, tier: tierFor(balls, players, tiers) };
}

export async function recordPour(deps: Deps, dayId: string, user: { userId: string; username: string }, rawBuild: unknown, claimed: unknown): Promise<PourResult | ApiError> {
  const { store } = deps;
  const meta = await readMeta(store, dayId);
  if (!meta) return { error: 'NO_DAY', message: 'No machine is running here yet.' };
  if (meta.status !== 'OPEN' || deps.now() >= meta.locksAt) return { error: 'LOCKED', message: "This machine has closed. Today's machine is in a new post." };
  const machine = await readMachine(store, meta.dayNumber);
  if (!machine) return { error: 'NO_DAY', message: 'No machine is running here yet.' };
  const build = cleanBuild(machine, rawBuild);
  if (!build) return { error: 'BAD_REQUEST', message: "That build isn't valid for today's machine." };
  const said = Math.max(0, Math.min(BALLS, Math.floor(Number(claimed) || 0)));

  // One pour every few seconds per player (a real pour takes longer than that to watch).
  const coolKey = K.cool(dayId, user.userId);
  if (await store.get(coolKey)) return { error: 'TOO_FAST', message: 'Easy! One pour at a time.' };
  await store.set(coolKey, '1', { expiration: new Date(deps.now() + COOLDOWN_MS) });

  const prev = await readBest(deps, dayId, user.userId);
  const prevScore = prev?.s ?? -1;
  // Only a pour that would raise your best needs the official re-run.
  let score = said;
  if (said > prevScore) {
    score = runPour(machine, build);
    if (score !== said) deps.log('warn', `pour mismatch for ${user.username} on Day ${meta.dayNumber}: phone ${said}, server ${score}`);
  }
  const improved = score > prevScore;
  const at = deps.now();
  const firstPour = (await store.hIncrBy(K.pours(dayId), user.userId, 1)) === 1;
  await store.hIncrBy(K.totals(dayId), 'pours', 1);
  await store.hIncrBy(K.totals(dayId), 'balls', score);
  if (improved) {
    const rec: BestRec = { u: user.username, s: score, at, b: buildKey(build) };
    await store.hSet(K.best(dayId), { [user.userId]: JSON.stringify(rec) });
    await store.zAdd(K.board(dayId), { member: user.userId, score: rankScore(score, at, meta.openedAt) });
    if (score === BALLS && prevScore < BALLS) await store.hIncrBy(K.totals(dayId), 'hundreds', 1);
  }
  if (firstPour) await store.hIncrBy(K.userStats(user.userId), 'days', 1);
  return {
    score,
    best: Math.max(score, prevScore),
    improved,
    rank: await rankOf(deps, dayId, user.userId),
    board: await topEntries(deps, dayId),
    totals: await readTotals(deps, dayId, ceilingOf(machine)),
  };
}

/** Moderator tool: take a player off today's board. */
export async function removeFromBoard(deps: Deps, dayId: string, username: string): Promise<string> {
  const name = username.replace(/^u\//i, '').trim().toLowerCase();
  const all = await deps.store.hGetAll(K.best(dayId));
  for (const [userId, raw] of Object.entries(all)) {
    const r = JSON.parse(raw) as BestRec;
    if (r.u.toLowerCase() !== name) continue;
    await deps.store.zRem(K.board(dayId), [userId]);
    await deps.store.hDel(K.best(dayId), [userId]);
    return `Removed u/${r.u} (${r.s}) from today's board.`;
  }
  return `u/${name} isn't on today's board.`;
}
