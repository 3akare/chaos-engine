import { describe, expect, it } from 'vitest';
import { generateDay, historyOf, tryAttempt, baseSeedFor, type DayHistory } from '../src/shared/generator/generate';
import { planForWeekday } from '../src/shared/generator/difficulty';
import { validateMachine, isBuildable, countTrivialFixes, countVariantsDelivered, SIM_BUDGET } from '../src/shared/generator/validate';
import { FIXTURES } from '../src/shared/fixtures';
import { levelOf, simulate, solutionPieces, compareProgress } from '../src/shared/sim';
import type { Machine } from '../src/shared/types';
import { pc } from './helpers';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 11, 7, 12); // a Monday

const pad = (rows: string[]): string[] => {
  const r = rows.map((x) => x.padEnd(9, '.'));
  while (r.length < 13) r.push('.........');
  r.push('#########');
  return r;
};
const machine = (rows: string[], extra: Partial<Machine>): Machine => ({
  name: 'Test',
  objective: { type: 'DELIVER' },
  rows: pad(rows),
  start: { dx: 0 },
  links: [],
  inventory: { RAMP: 2, SPRING: 1, FAN: 1, BUMPER: 1 },
  solution: [],
  ...extra,
});

describe('generator', () => {
  it('the same seed produces a byte-identical machine', () => {
    const a = generateDay({ installSalt: 's', dayNumber: 7, openMs: T0, history: [] });
    const b = generateDay({ installSalt: 's', dayNumber: 7, openMs: T0, history: [] });
    expect(JSON.stringify(a.machine)).toBe(JSON.stringify(b.machine));
    const c = generateDay({ installSalt: 'other', dayNumber: 7, openMs: T0, history: [] });
    expect(JSON.stringify(c.machine)).not.toBe(JSON.stringify(a.machine));
  });

  it('100 consecutive days all produce validated machines within 200 attempts', () => {
    const hist: DayHistory[] = [];
    const attempts: number[] = [];
    for (let n = 1; n <= 100; n++) {
      const out = generateDay({ installSalt: 'gate', dayNumber: n, openMs: T0 + n * DAY, history: hist.slice(0, 2) });
      expect(out.fallback).toBe(false);
      expect(out.attemptsTried).toBeLessThanOrEqual(200);
      const v = validateMachine(out.machine, { tier: out.machine.gen!.tier, history: hist.slice(0, 2), families: out.machine.gen!.families });
      expect(v.reason).toBe('ok');
      attempts.push(out.attemptsTried);
      hist.unshift(historyOf(out.machine));
    }
    attempts.sort((a, b) => a - b);
    console.log(`generator: median attempts ${attempts[50]}, max ${attempts[99]}`);
  });

  it('each validated attempt stays within the sim budget', () => {
    const base = baseSeedFor('budget', 3);
    let found = 0;
    for (let a = 0; a < 60 && found < 5; a++) {
      const r = tryAttempt(base, a, planForWeekday(5), []);
      expect(r.sims).toBeLessThanOrEqual(SIM_BUDGET);
      if (r.machine) found++;
    }
    expect(found).toBeGreaterThan(0);
  });

  it('follows the weekly rhythm', () => {
    const tierOf = (wd: number) => planForWeekday(wd).tier;
    expect([1, 2, 3, 4, 5, 6, 0].map(tierOf)).toEqual([1, 1, 2, 2, 3, 3, 2]);
    expect(planForWeekday(6).checkpoints).toBeGreaterThan(0);
    const sat = generateDay({ installSalt: 's', dayNumber: 13, openMs: T0 + 5 * DAY, history: [] });
    expect(sat.machine.objective.type).toBe('CHECKPOINTS_THEN_DELIVER');
    expect(sat.machine.gen!.tier).toBe(3);
  });

  it('tiers decide the solution size', () => {
    for (const [wd, size] of [[1, 2], [3, 3], [5, 4]] as const) {
      const out = generateDay({ installSalt: 'size', dayNumber: wd, openMs: T0 + (wd - 1) * DAY, history: [] });
      expect(out.machine.solution).toHaveLength(size);
    }
  });

  it('a pinned attempt is used when it validates', () => {
    const plain = generateDay({ installSalt: 'pin', dayNumber: 4, openMs: T0, history: [] });
    const scan = [];
    for (let a = plain.attempt + 1; a < 200 && scan.length === 0; a++) {
      const r = tryAttempt(baseSeedFor('pin', 4), a, planForWeekday(1), []);
      if (r.machine) scan.push(a);
    }
    const pinned = generateDay({ installSalt: 'pin', dayNumber: 4, openMs: T0, history: [], pinAttempt: scan[0] });
    expect(pinned.attempt).toBe(scan[0]);
  });
});

describe('§5.3 checks reject crafted failures', () => {
  const good = FIXTURES[0]!;
  it('structural', () => {
    expect(validateMachine({ ...good, rows: good.rows.map((r, i) => (i === 3 ? r.slice(1) : r)) }, { tier: 1 }).failed).toBe('structural');
    expect(validateMachine({ ...good, rows: good.rows.map((r, i) => (i === 9 ? r.replace('T', '.') : r)) }, { tier: 1 }).failed).toBe('structural');
    expect(validateMachine({ ...good, solution: [{ socket: 'A1', type: 'RAMP', dir: 'DR' }] }, { tier: 1 }).failed).toBe('structural');
  });
  it('broken at start', () => {
    const m = machine(['....S', '', '', '', '', '', '', '', '', '', '', 'o...T'], { solution: [{ socket: 'A12', type: 'RAMP', dir: 'DR' }] });
    expect(validateMachine(m, { tier: 1 }).failed).toBe('broken');
  });
  it('interesting failure', () => {
    const m = machine(['S', '#', '', '', '', '', '', '', '', '', '', 'o...T'], { start: { dx: -1 }, solution: [{ socket: 'A12', type: 'RAMP', dir: 'DR' }] });
    expect(validateMachine(m, { tier: 1 }).failed).toBe('interesting');
  });
  it('solvable', () => {
    expect(validateMachine({ ...good, solution: [{ socket: 'I3', type: 'RAMP', dir: 'DR' }, good.solution![1]!] }, { tier: 1 }).failed).toBe('solvable');
  });
  const single = (blockR: boolean): Machine =>
    machine(['....S', '', '', blockR ? '.....#' : '', '', '', '', '....o', '....#', '', '', '', '.....T'], {
      solution: [{ socket: 'E8', type: 'RAMP', dir: 'DR' }],
      inventory: { RAMP: 1, SPRING: 1, FAN: 1, BUMPER: 0 },
    });
  it('secret-ball headroom', () => {
    const v = validateMachine(single(false), { tier: 1 });
    expect(v.failed).toBe('headroom');
    expect(v.variantsDelivered).toBe(5);
  });
  it('no trivial fix', () => {
    expect(validateMachine(single(true), { tier: 2 }).failed).toBe('trivial');
    expect(validateMachine(single(true), { tier: 1 }).ok).toBe(true);
    expect(countTrivialFixes(levelOf(single(true)), single(true).inventory)).toBeGreaterThan(0);
  });
  it('buildable under the rules', () => {
    // Two pieces that each lower P on their own: no order can avoid a drop.
    const m = machine(['....S', '....o', '....o', '', '####.####', '', '', '', '', '', '', '', '........T'], {});
    const level = levelOf(m);
    const A = pc('RAMP', 'DL', 4, 2);
    const B = pc('RAMP', 'DR', 4, 1);
    const P0 = simulate(level, []).progress;
    expect(compareProgress(simulate(level, [A]).progress, P0)).toBeLessThan(0);
    expect(compareProgress(simulate(level, [B]).progress, P0)).toBeLessThan(0);
    expect(isBuildable(level, [A, B])).toBe(false);
    expect(isBuildable(levelOf(good), solutionPieces(good))).toBe(true);
  });
  it('variety', () => {
    const fams = good.gen!.families;
    expect(validateMachine(good, { tier: 1, history: [{ families: ['x'], startX: 0 }, { families: fams, startX: 0 }], families: fams }).failed).toBe('variety');
    expect(validateMachine(good, { tier: 1, history: [{ families: ['x'], startX: 3 }], families: fams }).failed).toBe('variety');
    expect(validateMachine(good, { tier: 1, history: [{ families: ['x'], startX: 0 }], families: fams }).ok).toBe(true);
  });
  it('budget', () => {
    expect(validateMachine(good, { tier: 1, simsSpent: SIM_BUDGET - 10 }).failed).toBe('budget');
  });
  it('headroom counter', () => {
    expect(countVariantsDelivered(levelOf(good), solutionPieces(good))).toBe(4);
  });
});
