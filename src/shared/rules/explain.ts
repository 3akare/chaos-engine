/** Human verdicts built from run events, never from the progress tuple alone (§2.5, §4.7). */
import { cellName, circled } from '../coords';
import { compareProgress, distanceField } from '../sim/progress';
import type { Level } from '../sim/level';
import { H, W, type SimResult } from '../types';

export type Verdict = { kind: 'better' | 'same' | 'lower'; label: string; reason: string; text: string };

export const VERDICT_LABEL = { better: 'Better progress ✓', same: 'Same progress ✓', lower: 'Lower progress ✗' } as const;

function endCell(r: SimResult): string {
  const e = r.events.find((x) => x.kind === 'end');
  return e ? cellName(e.cell[0], e.cell[1]) : '?';
}

/** The visited cell nearest the target (fixed-geometry distance). */
function closestCell(level: Level, r: SimResult): string {
  const f = distanceField(level);
  let best = 9999;
  let name = endCell(r);
  for (const fr of r.frames) {
    if (fr.x < 0 || fr.x >= W || fr.y < 0 || fr.y >= H) continue;
    const d = f[fr.y * W + fr.x]!;
    if (d < best) {
      best = d;
      name = cellName(fr.x, fr.y);
    }
  }
  return name;
}

/** "falls into the void at E9", "stalls at C4", "delivers", … */
export function describeEnd(r: SimResult): string {
  const at = endCell(r);
  switch (r.end) {
    case 'success':
      return 'delivers';
    case 'lost':
      return `falls into the void at ${at}`;
    case 'stalled':
      return `stalls at ${at}`;
    case 'loop':
      return `loops forever near ${at}`;
    default:
      return `is still rolling at ${at} when time runs out`;
  }
}

/** Short failure title for the run screen (§7.3). */
export function failureTitle(r: SimResult): string {
  const at = endCell(r);
  switch (r.end) {
    case 'success':
      return 'Delivered!';
    case 'lost':
      return 'Lost to the void';
    case 'stalled':
      return `Stalled at ${at}`;
    case 'loop':
      return 'Perpetual motion achieved';
    default:
      return 'Out of time';
  }
}

function reached(level: Level, r: SimResult): string {
  if (r.progress[0]) return 'delivering';
  if (r.progress[1] > 0) return `reaching checkpoint ${circled(r.progress[1])}`;
  return `getting as far as ${closestCell(level, r)}`;
}

/** Compare Ball 1 before and after a candidate placement. */
export function verdict(level: Level, before: SimResult, after: SimResult, touched = true): Verdict {
  const c = compareProgress(after.progress, before.progress);
  let kind: Verdict['kind'];
  let reason: string;
  if (c > 0) {
    kind = 'better';
    if (after.progress[0]) reason = 'Ball 1 now delivers!';
    else if (after.progress[1] > before.progress[1]) reason = `Ball 1 now reaches checkpoint ${circled(after.progress[1])}.`;
    else reason = `Ball 1 now gets as far as ${closestCell(level, after)} before it ${describeEnd(after)}.`;
  } else if (c === 0) {
    kind = 'same';
    if (!touched) reason = `Ball 1 never touches it — a dormant piece. Ball 1 still ${describeEnd(after)}.`;
    else reason = `Ball 1 still ${describeEnd(after)}.`;
  } else {
    kind = 'lower';
    reason = `Ball 1 now ${describeEnd(after)} instead of ${reached(level, before)}.`;
  }
  const label = VERDICT_LABEL[kind];
  return { kind, label, reason, text: `${label}: ${reason}` };
}
