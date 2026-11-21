import { describe, expect, it } from 'vitest';
import { levelOf, runBalls, simulate, solutionPieces, VARIANTS } from '../src/shared/sim';
import { FIXTURES } from '../src/shared/fixtures';
import { sha256Hex } from '../src/shared/sha256';
import { hash32 } from '../src/shared/rng';
import { dayId, nextLockAt, utcDate, utcWeekday } from '../src/shared/day';

describe('determinism', () => {
  it('identical input → identical SimResult across 1,000 runs', () => {
    const m = FIXTURES[2]!;
    const level = levelOf(m);
    const sol = solutionPieces(m);
    const ref = JSON.stringify(simulate(level, sol, { variant: 'BOUNCY' }));
    for (let i = 0; i < 1000; i++) expect(JSON.stringify(simulate(level, sol, { variant: 'BOUNCY' }))).toBe(ref);
  });

  it('golden runs for the five fixtures', () => {
    for (const m of FIXTURES) {
      const level = levelOf(m);
      const sol = solutionPieces(m);
      const runs = [simulate(level, []), ...['STANDARD' as const, ...VARIANTS.map((v) => v.id)].map((v) => simulate(level, sol, { variant: v }))];
      expect(runs.map((r) => ({ v: r.variant, end: r.end, ticks: r.ticks, progress: r.progress, path: r.frames.map((f) => `${f.x},${f.y},${f.mode[0]}`).join(' '), events: r.events.map((e) => `${e.tick}:${e.kind}@${e.cell.join(',')}${e.pieceId ? `#${e.pieceId}` : ''}${e.n !== undefined ? `=${e.n}` : ''}`).join(' ') }))).toMatchSnapshot(m.name);
    }
  });

  it('runBalls is pure', () => {
    const m = FIXTURES[0]!;
    const board = { level: levelOf(m), pieces: solutionPieces(m) };
    expect(runBalls(board, ['STANDARD', 'HEAVY', 'SLICK'])).toEqual(runBalls(board, ['STANDARD', 'HEAVY', 'SLICK']));
  });
});

describe('helpers', () => {
  it('sha256 matches known vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('a'.repeat(1000))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
  });
  it('hash32 is stable', () => {
    expect(hash32('a', 1)).toBe(hash32('a', 1));
    expect(hash32('a', 1)).not.toBe(hash32('a', 2));
  });
  it('day helpers', () => {
    const t = Date.UTC(2026, 11, 8, 18, 0); // Tue Dec 8 2026
    expect(utcDate(t)).toBe('2026-12-08');
    expect(utcWeekday(t)).toBe(2);
    expect(dayId(t, 5)).toBe('2026-12-08#5');
    expect(nextLockAt(t, 12)).toBe(Date.UTC(2026, 11, 9, 12));
    expect(nextLockAt(Date.UTC(2026, 11, 9, 11), 12)).toBe(Date.UTC(2026, 11, 9, 12));
  });
});
