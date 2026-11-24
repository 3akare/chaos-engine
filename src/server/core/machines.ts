/** Install config and the machine for each day (taken from the vetted pack, stored once). */
import { machineForDay } from '../../shared/pour/pack';
import type { Machine } from '../../shared/pour/types';
import type { PublicMachine } from '../../shared/protocol';
import type { Deps } from './deps';
import { newId, readMachine } from './day';
import { K } from './keys';

/** Machines close, get their results comment and hand off once a day at 02:00 UTC. */
export const DEFAULT_RESOLVE_HOUR = 2;

export type Config = { installSalt: string; resolveHourUtc: number };

export async function ensureConfig(deps: Deps): Promise<Config> {
  await deps.store.hSetNX(K.cfg, 'installSalt', newId(deps, 16));
  await deps.store.hSetNX(K.cfg, 'resolveHourUtc', String(DEFAULT_RESOLVE_HOUR));
  return readConfig(deps);
}

export async function readConfig(deps: Deps): Promise<Config> {
  const h = await deps.store.hGetAll(K.cfg);
  return { installSalt: h.installSalt ?? 'unset', resolveHourUtc: Number(h.resolveHourUtc ?? DEFAULT_RESOLVE_HOUR) };
}

/** Store (once) and return the machine for a day number. Never overwrites. */
export async function ensureMachine(deps: Deps, dayNumber: number): Promise<Machine> {
  const existing = await readMachine(deps.store, dayNumber);
  if (existing) return existing;
  await deps.store.set(K.level(dayNumber), JSON.stringify(machineForDay(dayNumber)), { nx: true });
  return (await readMachine(deps.store, dayNumber))!;
}

export async function ensureAhead(deps: Deps, fromDay: number, count = 2): Promise<void> {
  for (let k = 1; k <= count; k++) await ensureMachine(deps, fromDay + k);
}

/** Clients never see the generator's own best build. */
export function publicMachine(m: Machine): PublicMachine {
  const { gen: _g, ...rest } = m;
  return rest;
}
