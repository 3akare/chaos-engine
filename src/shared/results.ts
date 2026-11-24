/** Results text shared by the server (comment) and client (summary). */
import { resultsMarker } from './day';
import type { DayResult, StoredPiece } from './protocol';
import { pieceName } from './rules/placement';
import { variantInfo } from './sim/variants';

const pct = (n: number, d: number): number => (d === 0 ? 0 : Math.round((n * 100) / d));

export function ballLabel(i: number, result: Pick<DayResult, 'variants'>): string {
  const v = result.variants[i]!;
  return i === 0 ? 'Your ball' : `The ${variantInfo(v).short} ball`;
}

function endPhrase(end: string): string {
  switch (end) {
    case 'lost':
      return 'fell off the board';
    case 'stalled':
      return 'got stuck';
    case 'loop':
      return 'bounced around forever';
    default:
      return 'ran out of time';
  }
}

export function minutesBefore(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 1) return 'seconds before lock';
  if (m < 90) return `${m} min before lock`;
  return `${Math.round(m / 60)} h before lock`;
}

/** The app's results comment (§8). Always ends with the recovery marker line. */
export function resultsComment(dayNumber: number, r: DayResult, pieces: readonly StoredPiece[], endCells: readonly string[]): string {
  const lines: string[] = [];
  const misses = r.perBall
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => b.end !== 'success')
    .map(({ b, i }) => `${ballLabel(i, r)} ${endPhrase(b.end)}`);
  void endCells;
  lines.push(`⚙️ **${r.score}/3 delivered.**${misses.length ? ` ${misses.join('; ')}.` : ' A perfect run!'}`);
  const piece = (id: string | undefined): StoredPiece | undefined => pieces.find((p) => p.pieceId === id);
  const aw: string[] = [];
  const mvp = piece(r.awards.mvp?.pieceId);
  if (r.awards.mvp && mvp) aw.push(`🏆 MVP: u/${r.awards.mvp.username}'s ${pieceName(mvp.type)}`);
  const mt = piece(r.awards.mostTouched?.pieceId);
  if (r.awards.mostTouched && mt) aw.push(`👆 Most Touched: u/${r.awards.mostTouched.username}'s ${pieceName(mt.type)}`);
  if (r.awards.clutch) aw.push(`⏱ Clutch: u/${r.awards.clutch.username}, ${minutesBefore(r.lockedAt - r.awards.clutch.at)}`);
  if (aw.length) lines.push(aw.join(' · '));
  const total = r.predictions.reduce((a, b) => a + b, 0);
  const right = r.predictions[r.score] ?? 0;
  const pred = total > 0 ? `🔮 ${pct(right, total)}% predicted ${r.score}.` : '🔮 Nobody predicted today.';
  lines.push(`${pred} Streak: ${r.streak} ${r.streak === 1 ? 'day' : 'days'}. A new machine is up now — find it in the newest post.`);
  lines.push('');
  lines.push(resultsMarker(dayNumber));
  return lines.join('\n\n').replace(/\n\n\n\n/g, '\n\n');
}

/** Does this comment body carry the Day's marker as its last line? */
export function hasResultsMarker(body: string, dayNumber: number): boolean {
  const last = body.trim().split('\n').at(-1)?.trim() ?? '';
  return last === resultsMarker(dayNumber);
}
