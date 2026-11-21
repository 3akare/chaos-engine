import { describe, expect, it } from 'vitest';
import { grid, path, pc, run, visited } from './helpers';

describe('walls and rolling', () => {
  it('falls straight down, lands, and rolls in its dx', () => {
    const l = grid(['S', '', '#####'], { dx: 1 });
    const r = run(l);
    expect(path(r).slice(0, 6)).toEqual(['0,0', '0,1', '1,1', '2,1', '3,1', '4,1']);
  });
  it('a wall stops a rolling ball', () => {
    const l = grid(['S..#', '####']);
    expect(run(l).end).toBe('stalled');
    expect(run(l).frames.at(-1)).toMatchObject({ x: 2, y: 0 });
  });
});

describe('ramp', () => {
  it('DR sets dx=+1 and drops diagonally', () => {
    const l = grid(['S', '', '', '#########'], { dx: -1 });
    const r = run(l, [pc('RAMP', 'DR', 0, 1)]);
    expect(path(r).slice(0, 4)).toEqual(['0,0', '0,1', '1,2', '2,2']);
  });
  it('DL sets dx=-1; moves sideways when the diagonal is blocked', () => {
    const l = grid(['....S', '...##', '#########']);
    const r = run(l, [pc('RAMP', 'DL', 5, 1)]);
    // Ball rolls right onto the ramp cell at F2 (5,1), which has floor below; the ramp sends it left.
    expect(visited(r, 5, 1)).toBe(true);
    expect(r.events.some((e) => e.kind === 'deflect')).toBe(true);
  });
});

describe('spring', () => {
  const floor = ['S', '', '', '', '', '', '', '#########'];
  it('U launches 3 cells straight up when the ball falls onto it, then loops', () => {
    const l = grid(floor, { dx: 0 });
    const r = run(l, [pc('SPRING', 'U', 0, 6)]);
    expect(r.events.filter((e) => e.kind === 'launch').length).toBeGreaterThanOrEqual(1);
    expect(visited(r, 0, 2)).toBe(true);
    const launchTick = r.events.find((e) => e.kind === 'launch')!.tick;
    expect(Math.min(...r.frames.slice(launchTick).map((f) => f.y))).toBe(2);
    expect(r.end).toBe('loop');
  });
  it('U carries a rolling ball up 3 and one cell on', () => {
    const l = grid(['S', '#.', '', '', '', '', '', '##.######']);
    const r = run(l, [pc('SPRING', 'U', 2, 7)]);
    // rolls along row 6 into (2,6), above the spring: up to (2,3), then (3,3).
    expect(visited(r, 2, 3)).toBe(true);
    expect(visited(r, 3, 3)).toBe(true);
  });
  it('UR arc: two up-right, two right, then dx=+1', () => {
    const l = grid(floor, { dx: 0 });
    const r = run(l, [pc('SPRING', 'UR', 0, 6)]);
    const p = path(r);
    const i = p.indexOf('0,5');
    expect(p.slice(i, i + 5)).toEqual(['0,5', '1,4', '2,3', '3,3', '4,3']);
  });
  it('UL mirrors UR', () => {
    const l = grid(['........S', '', '', '', '', '', '', '#########'], { dx: 0 });
    const r = run(l, [pc('SPRING', 'UL', 8, 6)]);
    const p = path(r);
    const i = p.indexOf('8,5');
    expect(p.slice(i, i + 5)).toEqual(['8,5', '7,4', '6,3', '5,3', '4,3']);
  });
  it("a ball rolling into a spring's side treats it as a wall", () => {
    const l = grid(['S', '#########']);
    const r = run(l, [pc('SPRING', 'U', 3, 0)]);
    expect(r.end).toBe('stalled');
    expect(r.frames.at(-1)).toMatchObject({ x: 2, y: 0 });
  });
});

describe('fan', () => {
  it('R beam sets dx on a ball resting in it', () => {
    const l = grid(['..S', '', '#########'], { dx: 0 });
    const r = run(l, [pc('FAN', 'R', 0, 1)]);
    expect(visited(r, 3, 1)).toBe(true);
    expect(r.end).toBe('lost');
  });
  it('beam range is 3 cells', () => {
    const l = grid(['....S', '', '#########'], { dx: 0 });
    expect(run(l, [pc('FAN', 'R', 0, 1)]).end).toBe('stalled'); // ball at distance 4
    expect(run(l, [pc('FAN', 'R', 1, 1)]).end).toBe('lost'); // distance 3
  });
  it('beam stops at solid cells', () => {
    const l = grid(['...S', '.#', '#########'], { dx: 0 });
    expect(run(l, [pc('FAN', 'R', 0, 1)]).end).toBe('stalled');
  });
  it('L beam blows a falling ball sideways', () => {
    const l = grid(['.....S', '', '', '', '', '', '', '#########'], { dx: 0 });
    const r = run(l, [pc('FAN', 'L', 8, 3)]);
    expect(visited(r, 4, 3)).toBe(true);
  });
  it('U beam lifts a rolling ball and slips it out sideways at the top', () => {
    const l = grid(['S', '', '', '', '', '', '##.######']);
    const r = run(l, [pc('FAN', 'U', 2, 6)]);
    // (2,5) is above the fan; beam covers y=5,4,3. Top is y=3; slip to (3,3).
    expect(visited(r, 2, 3)).toBe(true);
    expect(visited(r, 3, 3)).toBe(true);
    expect(visited(r, 2, 2)).toBe(false);
  });
  it('fan body is solid (a floor)', () => {
    const l = grid(['S', '', '', '#########'], { dx: 0 });
    const r = run(l, [pc('FAN', 'R', 0, 2)]);
    expect(r.frames.at(-1)).toMatchObject({ x: 0, y: 1 });
  });
});

describe('bumper', () => {
  it('from the side: reverses dx and hops up one', () => {
    const l = grid(['', 'S', '#########']);
    const r = run(l, [pc('BUMPER', 'L', 3, 1)]);
    const p = path(r);
    expect(p).toContain('2,1');
    expect(p[p.indexOf('2,1') + 1]).toBe('1,0');
    expect(r.end).toBe('lost'); // rolls back left off the edge
  });
  it('from above: deflects to its side and hops', () => {
    const l = grid(['..S', '', '', '#########'], { dx: -1 });
    const r = run(l, [pc('BUMPER', 'R', 2, 2)]);
    const p = path(r);
    expect(p.slice(0, 3)).toEqual(['2,0', '2,1', '3,0']);
    expect(r.end).toBe('lost'); // then falls and rolls right off the board
  });
});

describe('gates and switches', () => {
  const links = [{ switch: 'B1', gates: ['E1'] }];
  it('a closed gate blocks; a switch opens it', () => {
    const closed = grid(['S..G', '####'], { links: [] });
    expect(run(closed).end).toBe('stalled');
    const l = grid(['Sw..G', '#########'], { links });
    const r = run(l);
    expect(r.events.map((e) => e.kind)).toEqual(expect.arrayContaining(['switch', 'gate']));
    expect(visited(r, 4, 0)).toBe(true);
  });
  it('an open gate can be closed by its switch', () => {
    const l = grid(['Sw..g', '#########'], { links });
    const r = run(l);
    expect(r.end).toBe('stalled');
    expect(r.frames.at(-1)).toMatchObject({ x: 3, y: 0 });
  });
});
