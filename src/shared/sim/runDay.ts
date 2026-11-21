import type { BoardPiece, Progress, SimResult, VariantId } from '../types';
import { simulate } from './engine';
import type { Board } from './board';
import { pickVariants } from './variants';

export type BallTrio = [SimResult, SimResult, SimResult];
/** [balls delivered, total checkpoints, summed distance progress] — compared lexicographically (§2.8). */
export type Outcome = [number, number, number];

export type DayRun = {
  variants: [VariantId, VariantId, VariantId];
  balls: BallTrio;
  score: number;
  checkpoints: number;
  outcome: Outcome;
};

export function runBalls(board: Board, variants: readonly [VariantId, VariantId, VariantId], pieces?: readonly BoardPiece[]): DayRun {
  const ps = pieces ?? board.pieces;
  const balls = variants.map((v) => simulate(board.level, ps, { variant: v })) as BallTrio;
  return { variants: [...variants] as DayRun['variants'], balls, ...summarize(balls) };
}

export function summarize(balls: readonly SimResult[]): { score: number; checkpoints: number; outcome: Outcome } {
  let score = 0;
  let checkpoints = 0;
  let prog = 0;
  for (const b of balls) {
    score += b.progress[0];
    checkpoints += b.progress[1];
    prog += b.progress[2];
  }
  return { score, checkpoints, outcome: [score, checkpoints, prog] };
}

export const compareOutcome = (a: Outcome, b: Outcome): number => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** The three balls for a Day seed: Ball 1 standard, Balls 2–3 the seed's secret variants (§2.6). */
export function dayVariants(seed: number): [VariantId, VariantId, VariantId] {
  const [a, b] = pickVariants(seed);
  return ['STANDARD', a, b];
}

/** runDay(board, seed) (§4.8): the three runs and the community score. Awards: see awards.ts. */
export function runDay(board: Board, seed: number): DayRun {
  return runBalls(board, dayVariants(seed));
}

/** P(board): Ball 1's progress score (§4.7). */
export const ball1Progress = (board: Board, pieces?: readonly BoardPiece[]): Progress =>
  simulate(board.level, pieces ?? board.pieces).progress;
