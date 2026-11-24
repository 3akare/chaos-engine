/** Install config and generate-ahead (§5.5). Generation never runs on the hand-off path. */
import { generateDay, GENERATOR_VERSION, historyOf, type DayHistory } from '../../shared/generator/generate';
import type { Machine } from '../../shared/types';
import type { Deps } from './deps';
import { newId, readMachine } from './day';
import { K } from './keys';

/** Machines lock, resolve and hand off once a day at 02:00 UTC. */
export const DEFAULT_RESOLVE_HOUR = 2;
/** Bump to re-apply DEFAULT_RESOLVE_HOUR to existing installs (see migrateSchedule). */
export const SCHEDULE_VERSION = 2;
const DAY_MS = 86_400_000;

export type Config = { installSalt: string; resolveHourUtc: number; generatorVersion: number };

export async function ensureConfig(deps: Deps): Promise<Config> {
  const { store } = deps;
  await store.hSetNX(K.cfg, 'installSalt', newId(deps, 16));
  await store.hSetNX(K.cfg, 'resolveHourUtc', String(DEFAULT_RESOLVE_HOUR));
  await store.hSetNX(K.cfg, 'generatorVersion', String(GENERATOR_VERSION));
  await store.hSetNX(K.cfg, 'scheduleVersion', String(SCHEDULE_VERSION));
  return readConfig(deps);
}

export async function readConfig(deps: Deps): Promise<Config> {
  const h = await deps.store.hGetAll(K.cfg);
  return {
    installSalt: h.installSalt ?? 'unset',
    resolveHourUtc: Number(h.resolveHourUtc ?? DEFAULT_RESOLVE_HOUR),
    generatorVersion: Number(h.generatorVersion ?? GENERATOR_VERSION),
  };
}

async function historyFor(deps: Deps, dayNumber: number): Promise<DayHistory[]> {
  const out: DayHistory[] = [];
  for (const n of [dayNumber - 1, dayNumber - 2]) {
    if (n < 1) break;
    const m = await readMachine(deps.store, n);
    if (m) out.push(historyOf(m));
  }
  return out;
}

/** Generate (and store) the machine for one Day if it doesn't exist yet. Never overwrites. */
export async function ensureMachine(deps: Deps, dayNumber: number, openMs: number): Promise<Machine> {
  const existing = await readMachine(deps.store, dayNumber);
  if (existing) return existing;
  const cfg = await readConfig(deps);
  const pin = await deps.store.get(K.pin(dayNumber));
  const out = generateDay({
    installSalt: cfg.installSalt,
    dayNumber,
    openMs,
    history: await historyFor(deps, dayNumber),
    pinAttempt: pin !== undefined ? Number(pin) : undefined,
  });
  if (out.fallback) deps.log('error', `generator: Day ${dayNumber} fell back to fixture "${out.machine.name}" after ${out.attemptsTried} attempts`, out.rejections);
  await deps.store.set(K.level(dayNumber), JSON.stringify(out.machine), { nx: true });
  return (await readMachine(deps.store, dayNumber)) ?? out.machine;
}

/**
 * Make sure the next `count` Days have machines. `fromDay` is the current day number and
 * `currentLocksAt` its lock time, which is when the next Day opens (decides the weekday tier).
 */
export async function ensureAhead(deps: Deps, fromDay: number, currentLocksAt: number, count = 2): Promise<void> {
  for (let k = 1; k <= count; k++) await ensureMachine(deps, fromDay + k, currentLocksAt + (k - 1) * DAY_MS);
}

/** Mod tool: clear unpinned future machines so they regenerate with the current generator. */
export async function regenerateUpcoming(deps: Deps, currentDay: number, horizon = 7): Promise<number> {
  let n = 0;
  for (let d = currentDay + 1; d <= currentDay + horizon; d++) {
    if ((await deps.store.get(K.pin(d))) !== undefined) continue;
    if ((await deps.store.get(K.level(d))) !== undefined) {
      await deps.store.del(K.level(d));
      n++;
    }
  }
  return n;
}

/** Strip the solution before anything reaches a client (§5.5). */
export function publicMachine(m: Machine): Omit<Machine, 'solution'> {
  const { solution: _s, ...rest } = m;
  return rest;
}
