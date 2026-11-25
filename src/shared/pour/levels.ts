/** Practice mode (called "personal" in code): fixed levels played in order, and the stars every pour can earn. */
import PERSONAL_JSON from './personal.json';
import type { Machine } from './types';

export const LEVELS = PERSONAL_JSON as unknown as Machine[];

/** Balls for one, two and three stars. Same in Personal and Group. */
export const STARS = [25, 50, 75] as const;
export const starsFor = (balls: number): number => STARS.filter((t) => balls >= t).length;

/** A level is open once the one before it has a star. */
export function unlocked(best: readonly (number | null)[], level: number): boolean {
  return level === 0 || starsFor(best[level - 1] ?? 0) >= 1;
}
