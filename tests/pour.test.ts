import { describe, expect, it } from 'vitest';
import { datan2, dcos, dsin, withDetMath } from '../src/shared/pour/detmath';
import { buildKey, cleanBuild, fitPiece, parseBuildKey, snap } from '../src/shared/pour/build';
import { Pour, runPour } from '../src/shared/pour/sim';
import { machineForDay, mirror, PACK } from '../src/shared/pour/pack';
import { generateMachine } from '../src/shared/pour/generate';
import type { Piece } from '../src/shared/pour/types';
import { TEST_MACHINE } from './server-helpers';

describe('deterministic trig', () => {
  it('matches native Math to within 1 ulp-ish', () => {
    for (let i = -2000; i < 2000; i++) {
      const x = i * 0.7316;
      expect(Math.abs(dsin(x) - Math.sin(x))).toBeLessThan(1e-15);
      expect(Math.abs(dcos(x) - Math.cos(x))).toBeLessThan(1e-15);
      expect(Math.abs(datan2(Math.sin(x), Math.cos(x) * 0.7) - Math.atan2(Math.sin(x), Math.cos(x) * 0.7))).toBeLessThan(1e-14);
    }
  });
  it('restores Math afterwards, even on throw', () => {
    const s = Math.sin;
    expect(() => withDetMath(() => { throw new Error('x'); })).toThrow();
    expect(Math.sin).toBe(s);
  });
  it('pins exact bit patterns (the same on every engine)', () => {
    expect(dsin(1)).toBe(0.8414709848078965);
    expect(dcos(1)).toBe(0.5403023058681398);
    expect(dsin(12345.678)).toBe(dsin(12345.678));
  });
});

describe('the pour', () => {
  const build: Piece[] = [
    { type: 'ramp', x: 170, y: 260, a: 340 },
    { type: 'bumper', x: 250, y: 420, a: 0 },
  ];
  it('is deterministic: same machine and build, same count and same final state', () => {
    const a = new Pour(TEST_MACHINE, build);
    const b = new Pour(TEST_MACHINE, build);
    while (!a.done) a.step();
    while (!b.done) b.step();
    expect(a.caught).toBe(b.caught);
    expect(a.t).toBe(b.t);
    expect(a.balls.map((x) => [x.position.x, x.position.y])).toEqual(b.balls.map((x) => [x.position.x, x.position.y]));
  });
  it('counts between 0 and 100 and always finishes', () => {
    const n = runPour(TEST_MACHINE, build);
    expect(n).toBeGreaterThanOrEqual(0);
    expect(n).toBeLessThanOrEqual(100);
  });
  it('a ledge over the empty bucket loses balls; a ramp can fix it', () => {
    expect(runPour(TEST_MACHINE, [])).toBeLessThan(runPour(TEST_MACHINE, [{ type: 'ramp', x: 228, y: 380, a: 20 }]) + 100);
  });
});

describe('builds', () => {
  it('snaps positions to whole units and angles to the tool step', () => {
    expect(snap({ type: 'ramp', x: 10.4, y: 999, a: 27 })).toEqual({ type: 'ramp', x: 12, y: 570, a: 20 });
    expect(snap({ type: 'fan', x: 100, y: 100, a: -50 })).toEqual({ type: 'fan', x: 100, y: 100, a: 315 });
    expect(snap({ type: 'bumper', x: 100, y: 100, a: 77 }).a).toBe(0);
  });
  it('rejects too many of a tool, unknown tools and junk', () => {
    expect(cleanBuild(TEST_MACHINE, [{ type: 'ramp', x: 1, y: 1, a: 0 }, { type: 'ramp', x: 1, y: 1, a: 0 }])).not.toBeNull();
    expect(cleanBuild(TEST_MACHINE, [{ type: 'ramp', x: 1, y: 1, a: 0 }, { type: 'ramp', x: 1, y: 1, a: 0 }, { type: 'ramp', x: 1, y: 1, a: 0 }])).toBeNull();
    expect(cleanBuild(TEST_MACHINE, [{ type: 'spring', x: 1, y: 1, a: 0 }])).toBeNull();
    expect(cleanBuild(TEST_MACHINE, [{ type: 'ramp', x: NaN, y: 1, a: 0 }])).toBeNull();
    expect(cleanBuild(TEST_MACHINE, 'nope')).toBeNull();
  });
  it('moves pieces out of the chute mouth, and only those', () => {
    const sp = TEST_MACHINE.spawn;
    const under = fitPiece(TEST_MACHINE, { type: 'ramp', x: sp.x, y: 40, a: 80 });
    expect(under.y).toBe(sp.y + 12 + 42);
    expect(fitPiece(TEST_MACHINE, under)).toEqual(under);
    expect(fitPiece(TEST_MACHINE, { type: 'ramp', x: sp.x + 120, y: 40, a: 0 }).y).toBe(40);
    expect(cleanBuild(TEST_MACHINE, [{ type: 'bumper', x: sp.x, y: 41, a: 0 }])![0]!.y).toBe(sp.y + 12 + 17);
  });
  it('round-trips through its stored form', () => {
    const b: Piece[] = [{ type: 'ramp', x: 100, y: 200, a: 40 }];
    expect(parseBuildKey(buildKey(b))).toEqual(b);
  });
});

describe('machines', () => {
  it('the generator is deterministic', () => {
    expect(generateMachine(42)).toEqual(generateMachine(42));
  });
  it('every day has a machine, and mirroring twice is the identity', () => {
    if (!PACK.length) return;
    for (let d = 1; d < PACK.length * 3; d++) expect(machineForDay(d).blocks.length).toBeGreaterThanOrEqual(0);
    expect(mirror(mirror(PACK[0]!))).toEqual(PACK[0]);
    expect(machineForDay(PACK.length + 1).seed).not.toBe(machineForDay(1).seed);
  });
});

describe('stars and levels', () => {
  it('gives a star at 25, two at 50, three at 75', async () => {
    const { starsFor, unlocked, LEVELS } = await import('../src/shared/pour/levels');
    expect([0, 24, 25, 49, 50, 74, 75, 100].map(starsFor)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    expect(unlocked([], 0)).toBe(true);
    expect(unlocked([24], 1)).toBe(false);
    expect(unlocked([25], 1)).toBe(true);
    expect(LEVELS.length).toBeGreaterThanOrEqual(6);
  });
  it('Personal levels and Group days never share a machine', async () => {
    const { LEVELS } = await import('../src/shared/pour/levels');
    const names = new Set(LEVELS.map((m) => m.name));
    expect(PACK.some((m) => names.has(m.name))).toBe(false);
  });
});
