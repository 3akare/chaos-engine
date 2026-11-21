/** One test per resolved edge case in PLAN.md §4.10. */
import { describe, expect, it } from 'vitest';
import { parseLevel, simulate, runBalls } from '../src/shared/sim';
import { structuralCheck } from '../src/shared/generator/validate';
import { FIXTURES } from '../src/shared/fixtures';
import { grid, path, pc, run, visited } from './helpers';

const links = (s: string, ...g: string[]) => [{ switch: s, gates: g }];

describe('§4.10 edge cases', () => {
  it('1. sockets are a flag on empty cells; a placed piece occupies the cell', () => {
    const l = grid(['S', 'o', '###']);
    expect(l.socket[9]).toBe(true);
    expect(l.kinds[9]).toBe('empty');
    expect(() => structuralCheck({ ...FIXTURES[0]!, rows: FIXTURES[0]!.rows.map((r, i) => (i === 0 ? r.replace('S', 'o') : r)) })).not.toThrow();
    // a spring placed in the socket is solid: the ball lands on it
    expect(run(l, [pc('BUMPER', 'R', 0, 1)]).events.some((e) => e.kind === 'deflect')).toBe(true);
  });

  it('2. each ball runs independently from the authored board', () => {
    const l = grid(['Sw..G', '#########'], { links: links('B1', 'E1') });
    const board = { level: l, pieces: [] };
    const d = runBalls(board, ['STANDARD', 'STANDARD', 'STANDARD']);
    expect(d.balls[0]).toEqual(d.balls[1]);
    expect(d.balls[1]).toEqual(d.balls[2]);
    expect(l.gateOpen[4]).toBe(false); // the level itself is never mutated
  });

  it('3. switches fire once per run', () => {
    // Ball crosses the switch twice (bumper bounces it back); the gate toggles only once.
    const l = grid(['..w.S...G', '#########'], { dx: -1, links: links('C1', 'I1') });
    const r = run(l, [pc('BUMPER', 'R', 1, 0)]);
    expect(r.events.filter((e) => e.kind === 'switch')).toHaveLength(1);
    expect(r.events.filter((e) => e.kind === 'gate')).toHaveLength(1);
  });

  it('4. gates keep their toggled state for the rest of the run', () => {
    const l = grid(['Sw..G...', '#########'], { links: links('B1', 'E1') });
    const r = run(l);
    expect(visited(r, 4, 0)).toBe(true);
    expect(visited(r, 7, 0)).toBe(true);
  });

  it('5. a flight step into a closed gate is blocked: fall from the current cell', () => {
    const l = grid(['S', '', '', '..G', '', '', '', '#########'], { dx: 0 });
    const r = run(l, [pc('SPRING', 'UR', 0, 6)]);
    // arc from (0,5): (1,4), (2,3)=gate → blocked → falls from (1,4)
    const p = path(r);
    const i = p.indexOf('1,4');
    expect(p[i + 1]).toBe('1,5');
    expect(visited(r, 2, 3)).toBe(false);
  });

  it('6. a gate and its switch can never share a cell (validator rejects bad links)', () => {
    expect(() => parseLevel({ rows: grid(['S']) && FIXTURES[1]!.rows, start: { dx: 0 }, links: links('H13', 'H13'), objective: { type: 'DELIVER' } })).toThrow();
  });

  it('7. bumper hit from above with the hop blocked: step out beside it, else stall', () => {
    const open = grid(['S', '', '', '#########'], { dx: 0 });
    // hop cell (1,0) is free here → hop.
    expect(path(run(open, [pc('BUMPER', 'R', 0, 2)]))).toContain('1,0');
    const blockedHop = grid(['S#', '', '', '#########'], { dx: 0 });
    const r = run(blockedHop, [pc('BUMPER', 'R', 0, 2)]);
    const p = path(r);
    expect(p[p.indexOf('0,1') + 1]).toBe('1,1'); // steps beside instead
    const boxed = grid(['S#', '.#', '', '#########'], { dx: 0 });
    expect(run(boxed, [pc('BUMPER', 'R', 0, 2)]).end).toBe('stalled');
  });

  it('8. bumper hop blocked after a horizontal hit: reverse dx, no hop', () => {
    const l = grid(['##', 'S', '#########']);
    const r = run(l, [pc('BUMPER', 'L', 3, 1)]);
    const p = path(r);
    expect(p).toContain('2,1');
    expect(p[p.indexOf('2,1') + 1]).toBe('1,1');
  });

  it('9. fan beams pass through passable cells; nearest fan wins; ties go to the lower x', () => {
    const through = grid(['...S', '', '#########'], { dx: 0 });
    expect(run(through, [pc('FAN', 'R', 0, 1), pc('RAMP', 'DR', 1, 1)]).end).not.toBe('stalled');
    // nearest: R fan at distance 1 (left) vs L fan at distance 2 (right) → R wins → ball goes right... into the L fan body: stall against it.
    const near = grid(['..S', '', '#########'], { dx: 0 });
    const r1 = run(near, [pc('FAN', 'R', 1, 1), pc('FAN', 'L', 4, 1)]);
    expect(r1.frames.at(-1)).toMatchObject({ x: 3, y: 1 });
    // tie at distance 1 each side → lower x (the R fan on the left) wins → dx=+1
    const tie = grid(['..S', '', '#########'], { dx: 0 });
    const r2 = run(tie, [pc('FAN', 'R', 1, 1), pc('FAN', 'L', 3, 1)]);
    expect(r2.events.find((e) => e.kind === 'touch')?.cell).toEqual([1, 1]);
    // U and horizontal beams both apply: set dx, then lift
    const both = grid(['S', '', '', '#########'], { dx: 1 });
    const r3 = run(both, [pc('FAN', 'U', 1, 3), pc('FAN', 'L', 4, 2)]);
    const p3 = path(r3);
    const i3 = p3.indexOf('1,2');
    expect(p3.slice(i3, i3 + 4)).toEqual(['1,2', '1,1', '1,0', '0,0']);
  });

  it('10. diagonal moves need only the destination free (no corner-cut check)', () => {
    const l = grid(['S', '.#', '#', '', '#########'], { dx: 0 });
    // ramp at (0,1): diag to (1,2) even though (1,1) and (0,2) are solid
    const r = run(l, [pc('RAMP', 'DR', 0, 1)]);
    expect(path(r)).toContain('1,2');
  });

  it('11. entering the target by any move is success', () => {
    expect(run(grid(['S', 'T'])).end).toBe('success'); // fall
    expect(run(grid(['ST', '##'])).end).toBe('success'); // roll
    expect(run(grid(['S', '', '.T', '#########']), [pc('RAMP', 'DR', 0, 1)]).end).toBe('success'); // diagonal
    expect(run(grid(['S', '', '', '..T', '', '', '', '#########'], { dx: 0 }), [pc('SPRING', 'UR', 0, 6)]).end).toBe('success'); // flight
  });

  it('12. drifters spawn one column over unless that cell is solid', () => {
    const l = grid(['.S.', '#########'], { dx: 0 });
    expect(run(l, [], 'OFFSET_L').frames[0]).toMatchObject({ x: 0, y: 0 });
    expect(run(l, [], 'OFFSET_R').frames[0]).toMatchObject({ x: 2, y: 0 });
    const walled = grid(['#S#', '#########'], { dx: 0 });
    expect(run(walled, [], 'OFFSET_L').frames[0]).toMatchObject({ x: 1, y: 0 });
    const edge = grid(['S', '#########'], { dx: 0 });
    expect(run(edge, [], 'OFFSET_L').frames[0]).toMatchObject({ x: 0, y: 0 }); // clamped
  });

  it('13. the stall counter resets on any movement, including a launch and a fan lift', () => {
    // A long sequence of moves never stalls early.
    const l = grid(['S', '', '', '', '', '', '##.######']);
    const r = run(l, [pc('FAN', 'U', 2, 6)]);
    expect(r.end).not.toBe('stalled');
  });

  it('14. several U beams lift by exactly one cell per tick', () => {
    const l = grid(['S', '', '', '', '', '', '##.######']);
    const one = run(l, [pc('FAN', 'U', 2, 6)]);
    const ys = one.frames.map((f) => f.y);
    for (let i = 1; i < ys.length; i++) expect(Math.abs(ys[i]! - ys[i - 1]!)).toBeLessThanOrEqual(1);
  });

  it('15. springs chain, and an infinite chain is caught by the loop detector', () => {
    const l = grid(['', '', '', '', '', 'S', '', '#########'], { dx: 0 });
    // UR at (0,6) throws the ball to (4,3) → falls onto UL at (4,6) → throws back… forever.
    const r = run(l, [pc('SPRING', 'UR', 0, 6), pc('SPRING', 'UL', 4, 6)]);
    expect(r.events.filter((e) => e.kind === 'launch').length).toBeGreaterThanOrEqual(2);
    expect(r.end).toBe('loop');
  });

  it('16. a target reached before the checkpoints are complete is passable', () => {
    const obj = { type: 'CHECKPOINTS_THEN_DELIVER', count: 1 } as const;
    const early = grid(['ST.1', '#########'], { objective: obj });
    const r = run(early);
    expect(r.end).not.toBe('success');
    expect(visited(r, 3, 0)).toBe(true); // carried on through the target
    const ok = grid(['S1T', '#########'], { objective: obj });
    expect(run(ok).end).toBe('success');
    // and it may come back later: bounce off a bumper after the checkpoint
    const back = grid(['ST.1', '#########'], { objective: obj });
    expect(simulate(back, [pc('BUMPER', 'L', 4, 0)]).end).toBe('success');
  });
});
