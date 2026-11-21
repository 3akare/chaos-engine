/** Daily machine generation with attempts, validation and fallback (§5.3, §5.5). */
import { FIXTURES } from '../fixtures';
import { hash32 } from '../rng';
import { parseLevel } from '../sim/level';
import type { Machine } from '../types';
import { construct } from './construct';
import { planForOpenTime, type DayPlan } from './difficulty';
import { validateMachine } from './validate';

/** Bump whenever generator output could change (§5.5). */
export const GENERATOR_VERSION = 1;
export const MAX_ATTEMPTS = 200;

export type DayHistory = { families: string[]; startX: number };

export type GenerateInput = {
  installSalt: string;
  dayNumber: number;
  /** When the Day opens (UTC ms) — decides the weekday tier. */
  openMs: number;
  /** Previous Days, newest first (variety check). */
  history: DayHistory[];
  /** Curation pin: try this attempt first (§5.7). */
  pinAttempt?: number | undefined;
};

export type GenerateOutput = {
  machine: Machine;
  attempt: number;
  attemptsTried: number;
  sims: number;
  fallback: boolean;
  rejections: Record<string, number>;
};

export const baseSeedFor = (installSalt: string, dayNumber: number): number => hash32(installSalt, dayNumber, GENERATOR_VERSION);
export const attemptSeed = (baseSeed: number, attempt: number): number => hash32(baseSeed, attempt);

export function historyOf(m: Machine): DayHistory {
  return { families: m.gen?.families ?? [], startX: parseLevel(m).start.x };
}

/** Build and validate one attempt. Returns the machine or the reason it was rejected. */
export function tryAttempt(baseSeed: number, attempt: number, plan: DayPlan, history: DayHistory[]): { machine: Machine | null; sims: number; why: string } {
  const c = construct(attemptSeed(baseSeed, attempt), plan);
  if (!c.machine) return { machine: null, sims: c.sims, why: `construct: ${c.why}` };
  const m = c.machine;
  m.gen = { ...m.gen!, baseSeed, attempt, version: GENERATOR_VERSION };
  const v = validateMachine(m, { tier: plan.tier, history, families: m.gen.families });
  if (!v.ok) return { machine: null, sims: c.sims + v.sims, why: `validate: ${v.failed}` };
  return { machine: m, sims: c.sims + v.sims, why: 'ok' };
}

export function generateDay(input: GenerateInput): GenerateOutput {
  const baseSeed = baseSeedFor(input.installSalt, input.dayNumber);
  const plan: DayPlan = { ...planForOpenTime(input.openMs), avoidStartX: input.history[0]?.startX };
  const rejections: Record<string, number> = {};
  let sims = 0;
  const order: number[] = [];
  if (input.pinAttempt !== undefined) order.push(input.pinAttempt);
  for (let a = 0; a < MAX_ATTEMPTS; a++) if (a !== input.pinAttempt) order.push(a);
  let tried = 0;
  for (const attempt of order.slice(0, MAX_ATTEMPTS)) {
    tried++;
    const r = tryAttempt(baseSeed, attempt, plan, input.history);
    sims += r.sims;
    if (r.machine) return { machine: r.machine, attempt, attemptsTried: tried, sims, fallback: false, rejections };
    const key = r.why.split(' (')[0]!.replace(/band \d/, 'band');
    rejections[key] = (rejections[key] ?? 0) + 1;
  }
  // Never fail to publish (§5.3): the next fallback fixture.
  const fx = FIXTURES[input.dayNumber % FIXTURES.length]!;
  const machine: Machine = JSON.parse(JSON.stringify(fx)) as Machine;
  machine.gen = { ...machine.gen!, baseSeed, attempt: -1, version: GENERATOR_VERSION, fallback: true };
  return { machine, attempt: -1, attemptsTried: tried, sims, fallback: true, rejections };
}

/** Up to `n` validated attempts for a Day, for curation in the seed gallery (§5.7). */
export function validatedAttempts(input: GenerateInput, n: number, maxScan = MAX_ATTEMPTS): Array<{ attempt: number; machine: Machine }> {
  const baseSeed = baseSeedFor(input.installSalt, input.dayNumber);
  const plan: DayPlan = { ...planForOpenTime(input.openMs), avoidStartX: input.history[0]?.startX };
  const out: Array<{ attempt: number; machine: Machine }> = [];
  for (let a = 0; a < maxScan && out.length < n; a++) {
    const r = tryAttempt(baseSeed, a, plan, input.history);
    if (r.machine) out.push({ attempt: a, machine: r.machine });
  }
  return out;
}
