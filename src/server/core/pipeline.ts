/**
 * The daily pipeline: OPEN → LOCKED → RESOLVED → COMMENTED → HANDED_OFF.
 * Every stage commits its own state and is safe to retry. The cron tick, the mod
 * "Run now" action and the install trigger all go through `tick`.
 */
import { dayId as makeDayId, dayTitle, nextLockAt } from '../../shared/day';
import type { DayResult } from '../../shared/protocol';
import type { Machine } from '../../shared/pour/types';
import { resultsComment } from '../../shared/results';
import type { Deps } from './deps';
import { currentDayId, encodeMeta, newId, readMachine, readMeta, type DayMeta } from './day';
import { K } from './keys';
import { ensureAhead, ensureConfig, ensureMachine, readConfig } from './machines';
import { ensureDayPost, ensureResultsComment } from './posts';
import { nextGoal, resolveDay } from './summary';

export const LEASE_MS = 5 * 60_000;
/** A Day opened off-schedule (install, Run now) runs at least this long, so there is one new game a day. */
export const MIN_DAY_MS = 12 * 3_600_000;

/** First lock at the daily hour that leaves the Day at least `minMs` long. */
export function lockTimeFor(openedAt: number, hourUtc: number, minMs = MIN_DAY_MS): number {
  let t = nextLockAt(openedAt, hourUtc);
  while (t - openedAt < minMs) t += 86_400_000;
  return t;
}

const fallbackText = (m: Machine, n: number): string =>
  `Chaos Engine Day ${n}: "${m.name}". 100 balls, one bucket. Place ramps, springs and fans to catch them all, and top today's leaderboard. Open this post in the Reddit app or on new Reddit to play.`;

/** Create a Day record (status CREATING) if it doesn't exist. Idempotent. */
export async function createDayRecord(deps: Deps, dayNumber: number, machine: Machine, openedAt: number, goal: number): Promise<string> {
  const { store } = deps;
  const existing = await store.get(K.dayByNumber(dayNumber));
  if (existing) return existing;
  const cfg = await readConfig(deps);
  const id = makeDayId(openedAt, dayNumber);
  const meta: DayMeta = {
    dayId: id,
    dayNumber,
    status: 'CREATING',
    openedAt,
    locksAt: lockTimeFor(openedAt, cfg.resolveHourUtc),
    goal,
    title: dayTitle(dayNumber, machine.name),
  };
  const tx = await store.watch(K.dayByNumber(dayNumber));
  if (await store.get(K.dayByNumber(dayNumber))) {
    await tx.unwatch();
    return (await store.get(K.dayByNumber(dayNumber)))!;
  }
  await tx.multi();
  await tx.hSet(K.meta(id), encodeMeta(meta));
  await tx.set(K.dayByNumber(dayNumber), id);
  await tx.exec();
  return (await store.get(K.dayByNumber(dayNumber))) ?? id;
}

/** CREATING → OPEN once its post exists, and point ce:day:current at it. */
async function openDay(deps: Deps, id: string, prevId: string | null): Promise<boolean> {
  const meta = await readMeta(deps.store, id);
  if (!meta) return false;
  const machine = await readMachine(deps.store, meta.dayNumber);
  if (!machine) return false;
  if (!(await ensureDayPost(deps, id, fallbackText(machine, meta.dayNumber)))) return false;
  const tx = await deps.store.watch(K.meta(id), K.current);
  await tx.multi();
  if (meta.status === 'CREATING') await tx.hSet(K.meta(id), { status: 'OPEN' });
  await tx.set(K.current, id);
  if (prevId) await tx.hSet(K.meta(prevId), { status: 'HANDED_OFF' });
  return (await tx.exec()) !== null;
}

/** OPEN → LOCKED, atomically, once now >= locksAt. */
export async function lockDay(deps: Deps, id: string): Promise<boolean> {
  const tx = await deps.store.watch(K.meta(id));
  const meta = await readMeta(deps.store, id);
  if (!meta || meta.status !== 'OPEN' || deps.now() < meta.locksAt) {
    await tx.unwatch();
    return false;
  }
  await tx.multi();
  await tx.hSet(K.meta(id), encodeMeta({ status: 'LOCKED', lockedAt: deps.now() }));
  return (await tx.exec()) !== null;
}

async function commentDay(deps: Deps, id: string): Promise<boolean> {
  const meta = await readMeta(deps.store, id);
  if (!meta || meta.status !== 'RESOLVED') return false;
  const raw = await deps.store.get(K.result(id));
  const machine = await readMachine(deps.store, meta.dayNumber);
  if (!raw || !machine) return false;
  const body = resultsComment(meta.dayNumber, machine.name, JSON.parse(raw) as DayResult);
  if (!(await ensureResultsComment(deps, id, body))) return false;
  await deps.store.hSet(K.meta(id), { status: 'COMMENTED' });
  return true;
}

/** COMMENTED → HANDED_OFF: open the next Day. */
async function handoffDay(deps: Deps, id: string): Promise<boolean> {
  const meta = await readMeta(deps.store, id);
  if (!meta || meta.status !== 'COMMENTED') return false;
  const n = meta.dayNumber + 1;
  let nextId = meta.nextDayId;
  if (!nextId) {
    const machine = await ensureMachine(deps, n);
    const raw = await deps.store.get(K.result(id));
    const balls = raw ? (JSON.parse(raw) as DayResult).totals.balls : 0;
    nextId = await createDayRecord(deps, n, machine, deps.now(), nextGoal(balls));
    await deps.store.hSet(K.meta(id), { nextDayId: nextId });
  }
  return openDay(deps, nextId, id);
}

/** Advance one stage if due. Returns true if something changed. */
async function step(deps: Deps, id: string): Promise<boolean> {
  const meta = await readMeta(deps.store, id);
  if (!meta) return false;
  switch (meta.status) {
    case 'OPEN':
      return lockDay(deps, id);
    case 'LOCKED':
      return resolveDay(deps, id);
    case 'RESOLVED':
      return commentDay(deps, id);
    case 'COMMENTED':
      return handoffDay(deps, id);
    case 'CREATING':
      return openDay(deps, id, null);
    default:
      return false;
  }
}

export type TickReport = { ran: boolean; reason?: string; stages: string[] };

/** Install: config, Day 1 machine + record + post. Safe to call repeatedly. */
export async function install(deps: Deps): Promise<string | null> {
  await ensureConfig(deps);
  if (await currentDayId(deps.store)) return currentDayId(deps.store);
  const now = deps.now();
  const machine = await ensureMachine(deps, 1);
  const id = await createDayRecord(deps, 1, machine, now, nextGoal(0));
  await openDay(deps, id, null);
  return currentDayId(deps.store);
}

/** The cron handler (§2.1). Takes a lease, advances as many stages as are due, generates ahead. */
export async function tick(deps: Deps): Promise<TickReport> {
  const { store } = deps;
  const token = newId(deps);
  await store.set(K.lock, token, { nx: true, expiration: new Date(deps.now() + LEASE_MS) });
  if ((await store.get(K.lock)) !== token) return { ran: false, reason: 'another tick holds the lease', stages: [] };
  const stages: string[] = [];
  try {
    let id = await currentDayId(store);
    if (!id) {
      id = await install(deps);
      stages.push('install');
      if (!id) return { ran: true, stages };
    }
    for (let i = 0; i < 8; i++) {
      const before = await readMeta(store, id);
      if (!before) break;
      let advanced = false;
      try {
        advanced = await step(deps, id);
      } catch (e) {
        deps.log('error', `stage ${before.status} of ${id} failed; will retry next tick`, String(e));
        break;
      }
      if (!advanced) break;
      const after = await readMeta(store, id);
      stages.push(`${before.status}→${after?.status ?? '?'}`);
      const cur = await currentDayId(store);
      if (cur && cur !== id) id = cur;
    }
    // Generate ahead last: the hand-off above only ever reads stored machines.
    try {
      const cur = await readMeta(store, id);
      if (cur) await ensureAhead(deps, cur.dayNumber, 2);
    } catch (e) {
      deps.log('error', 'generate-ahead failed', String(e));
    }
    return { ran: true, stages };
  } finally {
    if ((await store.get(K.lock)) === token) await store.del(K.lock);
  }
}

/** Mod action "Run now": lock immediately and go through the same tick. */
export async function runNow(deps: Deps): Promise<TickReport> {
  const id = await currentDayId(deps.store);
  if (id) {
    const meta = await readMeta(deps.store, id);
    if (meta?.status === 'OPEN') await deps.store.hSet(K.meta(id), { locksAt: String(deps.now()) });
  }
  return tick(deps);
}

/** Mod action "New post for today": recreate the current Day's post. */
export async function newPostForToday(deps: Deps): Promise<string> {
  const id = await currentDayId(deps.store);
  if (!id) return 'No Day is running yet.';
  const meta = await readMeta(deps.store, id);
  const machine = meta ? await readMachine(deps.store, meta.dayNumber) : null;
  if (!meta || !machine) return 'No Day is running yet.';
  const post = await deps.reddit.submitDayPost({ title: meta.title, textFallback: fallbackText(machine, meta.dayNumber) });
  await deps.store.set(K.post(post.id), id);
  await deps.store.hSet(K.meta(id), { postId: post.id });
  return `Created a new post for Day ${meta.dayNumber}.`;
}
