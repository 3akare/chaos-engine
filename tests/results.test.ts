import { describe, expect, it } from 'vitest';
import { hasResultsMarker, resultsComment } from '../src/shared/results';
import { titleHasMarker } from '../src/server/core/posts';
import type { DayResult } from '../src/shared/protocol';

const r: DayResult = {
  score: 2,
  checkpoints: 0,
  variants: ['STANDARD', 'HEAVY', 'OFFSET_L'],
  perBall: [
    { variant: 'STANDARD', end: 'success', progress: [1, 0, 0], ticks: 30 },
    { variant: 'HEAVY', end: 'lost', progress: [0, 0, -3], ticks: 20 },
    { variant: 'OFFSET_L', end: 'success', progress: [1, 0, 0], ticks: 31 },
  ],
  awards: {
    mvp: { pieceId: 'p1', userId: 'k', username: 'kestrel', value: 2 },
    mostTouched: { pieceId: 'p2', userId: 'm', username: 'moss', value: 4 },
    clutch: { pieceId: 'p2', userId: 'p', username: 'plover', value: 0, at: 1000 },
  },
  revealedSecret: 'ab'.repeat(32),
  lockedAt: 1000 + 14 * 60_000,
  predictions: [1, 2, 4, 3],
  builders: 5,
  streak: 4,
};
const pieces = [
  { pieceId: 'p1', socket: 'F4', type: 'SPRING' as const, dir: 'U' as const, userId: 'k', username: 'kestrel', placedAt: 0 },
  { pieceId: 'p2', socket: 'C3', type: 'RAMP' as const, dir: 'DR' as const, userId: 'm', username: 'moss', placedAt: 0 },
];

describe('results comment', () => {
  it('reads like §8 and ends with the recovery marker', () => {
    const body = resultsComment(12, r, pieces, ['I13', 'G11', 'I13']);
    expect(body).toContain('⭐⭐☆ **2 of 3 balls reached the flag.**');
    expect(body).toContain('The Heavy ball fell off the board');
    expect(body).not.toMatch(/[A-I]\d{1,2}\b/);
    expect(body).toContain("🏆 MVP: u/kestrel's spring");
    expect(body).toContain("👆 Most Touched: u/moss's ramp");
    expect(body).toContain('⏱ Clutch: u/plover, 14 min before lock');
    expect(body).toContain('Streak: 4 days');
    expect(hasResultsMarker(body, 12)).toBe(true);
    expect(hasResultsMarker(body, 1)).toBe(false);
    expect(hasResultsMarker(body, 2)).toBe(false);
  });
  it('post title markers never confuse Day 1 with Day 12', () => {
    expect(titleHasMarker('Chaos Engine · Day 12 · Fan Corridor', 12)).toBe(true);
    expect(titleHasMarker('Chaos Engine · Day 12 · Fan Corridor', 1)).toBe(false);
    expect(titleHasMarker('Chaos Engine · Day 1', 1)).toBe(true);
  });
});
