import { describe, expect, it } from 'vitest';
import { compareProgress, distanceField, UNREACHABLE } from '../src/shared/sim';
import { grid, pc, run } from './helpers';

describe('progress tuple', () => {
  it('orders lexicographically: delivered, then checkpoints, then distance', () => {
    expect(compareProgress([1, 0, 0], [0, 5, 0])).toBeGreaterThan(0);
    expect(compareProgress([0, 2, -9], [0, 1, 0])).toBeGreaterThan(0);
    expect(compareProgress([0, 1, -3], [0, 1, -4])).toBeGreaterThan(0);
    expect(compareProgress([0, 1, -3], [0, 1, -3])).toBe(0);
  });
  it('distance is the minimum field value over visited cells', () => {
    const stuck = grid(['S..#', '#####', '', '', '', '', '', '', '', '', '', '', '', '........T']);
    const s = run(stuck);
    const f = distanceField(stuck);
    expect(s.progress[2]).toBe(-f[2]!); // closest visited cell is (2,0)
  });
});

describe('distance field', () => {
  it('BFS over fixed geometry: walls block, gates pass, pieces are ignored', () => {
    const l = grid(['S', '########G', '', '', '', '', '', '', '', '', '', '', '', 'T'], { links: [] });
    const f = distanceField(l);
    expect(f[0]).toBeLessThan(UNREACHABLE); // reachable via the gate at I2
    const sealed = grid(['S', '#########', '', '', '', '', '', '', '', '', '', '', '', 'T']);
    expect(distanceField(sealed)[0]).toBe(UNREACHABLE);
  });
  it('a dormant piece that blocks a BFS route does not change P', () => {
    const l = grid(['S..#', '#####', '', '', '', '', '', '', '', '', '', '', '', '........T']);
    const before = run(l).progress;
    // A spring sitting on the only open route in fixed geometry, never touched by the ball.
    const after = run(l, [pc('SPRING', 'U', 5, 0)]).progress;
    expect(after).toEqual(before);
  });
});

describe('checkpoints', () => {
  const obj = { type: 'CHECKPOINTS_THEN_DELIVER', count: 3 } as const;
  it('counts the longest correctly ordered prefix', () => {
    expect(run(grid(['S1324', '#########'], { objective: obj })).progress[1]).toBe(2); // ① then ② (③ skipped before ②)
    expect(run(grid(['S213', '#########'], { objective: obj })).progress[1]).toBe(1); // ② too early, ① ok, ③ needs ②
    expect(run(grid(['S123', '#########'], { objective: obj })).progress[1]).toBe(3);
  });
  it('a target reached before checkpoints are complete is not delivered', () => {
    const r = run(grid(['S1T23', '#########'], { objective: obj }));
    expect(r.progress[0]).toBe(0);
    expect(r.end).not.toBe('success');
  });
});
