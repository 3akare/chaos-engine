/**
 * The daily pipeline: OPEN → LOCKED → RESOLVED → COMMENTED → HANDED_OFF.
 * Every stage commits its own state and is safe to retry. The cron tick, the mod
 * "Run now" action and the install trigger all go through `tick`.
 */
import { DAY_TITLE_PREFIX, dayId as makeDayId, dayTitle, nextLockAt } from '../../shared/day';
import type { DayResult } from '../../shared/protocol';
import type { Machine } from '../../shared/pour/types';
import { resultsComment } from '../../shared/results';
import type { Deps } from './deps';
import { currentDayId, encodeMeta, newId, readMachine, readMeta, type DayMeta } from './day';
import { K } from './keys';
import { ensureAhead, ensureConfig, ensureMachine, readConfig } from './machines';
import { ensureDayPost, ensureResultsComment } from './posts';
import { resolveDay } from './summary';

export const LEASE_MS = 5 * 60_000;
/**
 * New games come at 02:00 UTC every day. A first game opened just before 02:00 runs on to the
 * following 02:00 instead of lasting a few minutes.
 */
export const MIN_DAY_MS = 3_600_000;

/** The next lock at the daily hour that leaves the Day at least `minMs` long. */
export function lockTimeFor(openedAt: number, hourUtc: number, minMs = MIN_DAY_MS): number {
  let t = nextLockAt(openedAt, hourUtc);
  while (t - openedAt < minMs) t += 86_400_000;
  return t;
}

const fallbackText = (m: Machine, n: number): string =>
  `Chaos Engine Day ${n}: "${m.name}". 100 balls, one bucket. Place ramps, springs and fans to catch them all, and top today's leaderboard. Open this post in the Reddit app or on new Reddit to play.`;

/** Create a Day record (status CREATING) if it doesn't exist. Idempotent. */
export async function createDayRecord(deps: Deps, dayNumber: number, machine: Machine, openedAt: number): Promise<string> {
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
    goal: 0,
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
  // A first game held back to the next 02:00 (see install) is not posted before then.
  if (meta.status === 'CREATING' && deps.now() < meta.openedAt) return false;
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
    nextId = await createDayRecord(deps, n, machine, deps.now());
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

/**
 * Has this app already posted a game since the last daily hour? Then a new one now would be a
 * second game the same day. A failed search counts as "yes": waiting a few hours is safer than
 * a duplicate post.
 */
export async function postedSinceLastReset(deps: Deps, hourUtc: number): Promise<boolean> {
  const since = nextLockAt(deps.now(), hourUtc) - 86_400_000;
  try {
    const app = await deps.reddit.appUsername();
    const posts = await deps.reddit.newPosts(50);
    return posts.some((p) => p.authorName === app && p.title.startsWith(DAY_TITLE_PREFIX) && p.createdAt >= since);
  } catch (e) {
    deps.log('warn', 'could not check for a game posted earlier today; holding the first game to the next reset', String(e));
    return true;
  }
}

/**
 * Install (and an upgrade that finds no Day running): config, Day 1 machine and record. Day 1
 * is posted now, unless this app already posted a game since the last 02:00 UTC (for example an
 * upgrade from a version that kept its data elsewhere); then it waits for the next 02:00, so
 * there is never more than one new game a day. Safe to call repeatedly.
 */
export async function install(deps: Deps): Promise<string | null> {
  const cfg = await ensureConfig(deps);
  if (await currentDayId(deps.store)) return currentDayId(deps.store);
  const pending = await deps.store.get(K.dayByNumber(1));
  if (pending) {
    await openDay(deps, pending, null);
    return currentDayId(deps.store);
  }
  const now = deps.now();
  const machine = await ensureMachine(deps, 1);
  const opensAt = (await postedSinceLastReset(deps, cfg.resolveHourUtc)) ? nextLockAt(now, cfg.resolveHourUtc) : now;
  if (opensAt > now) deps.log('info', `a game was already posted today; Day 1 opens at ${new Date(opensAt).toISOString()}`);
  const id = await createDayRecord(deps, 1, machine, opensAt);
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

/**
 * Close today's machine now and open the next one. Used by tests to walk a whole day. Not on
 * the moderator menu: it would post a second game the same day.
 */
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
