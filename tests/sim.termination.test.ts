import { describe, expect, it } from 'vitest';
import { grid, pc, run } from './helpers';

describe('termination', () => {
  it('success when the ball enters the target', () => {
    const r = run(grid(['S..T', '#########']));
    expect(r.end).toBe('success');
    expect(r.progress[0]).toBe(1);
  });
  it('lost when the ball leaves the grid', () => {
    expect(run(grid(['S', '###'])).end).toBe('lost');
  });
  it('stalled after 3 ticks without movement', () => {
    const r = run(grid(['S', '#########'], { dx: 0 }));
    expect(r.end).toBe('stalled');
    expect(r.ticks).toBe(3); // spawns resting on the floor: 3 still ticks
  });
  it('loop when an identical state repeats (perpetual motion)', () => {
    const l = grid(['S', '', '', '', '', '', '', '#########'], { dx: 0 });
    expect(run(l, [pc('SPRING', 'U', 0, 6)]).end).toBe('loop');
  });
  it('timeout at the tick cap', async () => {
    const { simulate } = await import('../src/shared/sim');
    const r = simulate(grid(['S', '', '', '', '', '', '', '', '', '', '', '', '']), [], { maxTicks: 5 });
    expect(r.end).toBe('timeout');
    expect(r.ticks).toBe(5);
  });
  it('every run ends with exactly one end event', () => {
    const r = run(grid(['S', '###']));
    expect(r.events.filter((e) => e.kind === 'end')).toHaveLength(1);
  });
});
