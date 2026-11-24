/** Player-facing verdicts and run descriptions, in plain words (no grid coordinates). */
import { circled } from '../coords';
import { compareProgress } from '../sim/progress';
import type { Level } from '../sim/level';
import type { SimResult } from '../types';

export type Verdict = { kind: 'better' | 'same' | 'lower'; label: string; reason: string; text: string };

export const VERDICT_LABEL = { better: 'Better ✓', same: 'No change ✓', lower: 'Worse ✗' } as const;

/** "falls off the board", "gets stuck", "reaches the goal", … */
export function describeEnd(r: SimResult): string {
  switch (r.end) {
    case 'success':
      return 'reaches the goal';
    case 'lost':
      return 'falls off the board';
    case 'stalled':
      return 'gets stuck';
    case 'loop':
      return 'bounces around forever';
    default:
      return 'runs out of time';
  }
}

/** Short title for the run screen (§7.3). */
export function failureTitle(r: SimResult): string {
  switch (r.end) {
    case 'success':
      return 'Made it!';
    case 'lost':
      return 'Fell off the board';
    case 'stalled':
      return 'Got stuck';
    case 'loop':
      return 'Bouncing forever';
    default:
      return 'Out of time';
  }
}

function reached(r: SimResult): string {
  if (r.progress[0]) return 'reaching the goal';
  if (r.progress[1] > 0) return `reaching checkpoint ${circled(r.progress[1])}`;
  return 'getting closer to the goal';
}

/** Compare the test ball before and after a candidate placement. */
export function verdict(_level: Level, before: SimResult, after: SimResult, touched = true): Verdict {
  const c = compareProgress(after.progress, before.progress);
  let kind: Verdict['kind'];
  let reason: string;
  if (c > 0) {
    kind = 'better';
    if (after.progress[0]) reason = 'The ball now reaches the goal!';
    else if (after.progress[1] > before.progress[1]) reason = `The ball now reaches checkpoint ${circled(after.progress[1])}.`;
    else reason = `The ball gets closer to the goal now, then ${describeEnd(after)}.`;
  } else if (c === 0) {
    kind = 'same';
    reason = touched ? `The ball still ${describeEnd(after)}.` : `The ball doesn't touch this piece yet. It still ${describeEnd(after)}.`;
  } else {
    kind = 'lower';
    reason = `The ball would now ${describeEnd(after)} instead of ${reached(before)}.`;
  }
  const label = VERDICT_LABEL[kind];
  return { kind, label, reason, text: `${label} ${reason}` };
}
