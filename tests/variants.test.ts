import { describe, expect, it } from 'vitest';
import { pickVariants, VARIANTS, dayVariants } from '../src/shared/sim';
import { daySeed, hash32 } from '../src/shared/rng';
import { grid, path, pc, run, visited } from './helpers';

describe('variant effects', () => {
  it('OFFSET_L / OFFSET_R spawn one column over', () => {
    const l = grid(['...S', '#########'], { dx: 0 });
    expect(run(l, [], 'OFFSET_L').frames[0]!.x).toBe(2);
    expect(run(l, [], 'OFFSET_R').frames[0]!.x).toBe(4);
  });
  it('REVERSE flips the initial dx', () => {
    const l = grid(['...S', '#########'], { dx: 1 });
    expect(path(run(l, [], 'REVERSE'))[1]).toBe('2,0');
  });
  it('HEAVY: fan range 1; springs launch one cell lower', () => {
    const l = grid(['..S', '', '#########'], { dx: 0 });
    expect(run(l, [pc('FAN', 'R', 0, 1)]).end).toBe('lost'); // distance 2 is in range normally
    expect(run(l, [pc('FAN', 'R', 0, 1)], 'HEAVY').end).toBe('stalled');
    const s = grid(['S', '', '', '', '', '', '', '#########'], { dx: 0 });
    const normal = run(s, [pc('SPRING', 'U', 0, 6)]);
    const heavy = run(s, [pc('SPRING', 'U', 0, 6)], 'HEAVY');
    const apex = (r: typeof normal) => Math.min(...r.frames.slice(r.events.find((e) => e.kind === 'launch')!.tick).map((f) => f.y));
    expect(apex(normal)).toBe(2);
    expect(apex(heavy)).toBe(3);
  });
  it('BOUNCY: bumper hop +1; springs launch one cell higher', () => {
    const s = grid(['S', '', '', '', '', '', '', '#########'], { dx: 0 });
    const r = run(s, [pc('SPRING', 'U', 0, 6)], 'BOUNCY');
    const t = r.events.find((e) => e.kind === 'launch')!.tick;
    expect(Math.min(...r.frames.slice(t).map((f) => f.y))).toBe(1);
    const b = grid(['', '', 'S', '#########']);
    expect(visited(run(b, [pc('BUMPER', 'L', 3, 2)], 'BOUNCY'), 0, 0)).toBe(true);
    expect(visited(run(b, [pc('BUMPER', 'L', 3, 2)]), 0, 0)).toBe(false);
  });
  it('SLICK: ramps deflect sideways only', () => {
    const l = grid(['S', '', '', '#########'], { dx: -1 });
    expect(path(run(l, [pc('RAMP', 'DR', 0, 1)]))[2]).toBe('1,2');
    expect(path(run(l, [pc('RAMP', 'DR', 0, 1)], 'SLICK'))[2]).toBe('1,1');
  });
});

describe('variant selection', () => {
  it('is stable for a seed and always picks two distinct variants', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const s = hash32('day', i);
      const [a, b] = pickVariants(s);
      expect(a).not.toBe(b);
      expect(pickVariants(s)).toEqual([a, b]);
      seen.add(a);
      seen.add(b);
    }
    expect(seen.size).toBe(VARIANTS.length);
  });
  it('Ball 1 is always standard', () => {
    expect(dayVariants(daySeed('2026-12-01#3', 'ab'.repeat(32)))[0]).toBe('STANDARD');
  });
});
