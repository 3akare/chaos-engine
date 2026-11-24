/** The nightly results comment. The first line is the marker used to find it again after a crash. */
import { resultsMarker } from './day';
import type { DayResult } from './protocol';

const MEDAL = ['🥇', '🥈', '🥉'];
const fmt = (n: number): string => n.toLocaleString('en-US');

export function resultsComment(dayNumber: number, name: string, r: DayResult): string {
  const lines = [`**${resultsMarker(dayNumber)}** · ${name}`, ''];
  if (r.winner) {
    lines.push(
      r.winner.score === 100
        ? `**Build of the Day:** u/${r.winner.username} caught all 100 balls and got there first. Open the post to watch their pour.`
        : `**Build of the Day:** u/${r.winner.username} caught ${r.winner.score} of 100. Open the post to watch their pour.`,
      '',
    );
    lines.push(r.top.slice(0, 5).map((e, i) => `${MEDAL[i] ?? `${e.rank}.`} u/${e.username} **${e.score}**`).join(' · '), '');
  } else lines.push('Nobody poured today. The next machine is open now.', '');
  const t = r.totals;
  lines.push(
    `Together: **${fmt(t.balls)}** balls caught in ${fmt(t.pours)} pours by ${fmt(t.players)} ${t.players === 1 ? 'player' : 'players'}. Goal ${fmt(t.goal)}: ${r.goalMet ? `**done!**${r.streak > 1 ? ` That's ${r.streak} days in a row.` : ''}` : 'not this time.'}`,
  );
  if (t.hundreds) lines.push('', `${t.hundreds} ${t.hundreds === 1 ? 'player' : 'players'} caught all 100.`);
  lines.push('', 'A new machine is open now. Same 100 balls, new course.');
  return lines.join('\n');
}

export const hasResultsMarker = (body: string, dayNumber: number): boolean => body.includes(resultsMarker(dayNumber));
