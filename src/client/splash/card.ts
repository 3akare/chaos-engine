/**
 * The post in the feed, top to bottom:
 * - the logo, with Practice as a small pill in the corner;
 * - one big call to action, "Start the chaos" (on a closed day, "See the solution");
 * - the community goal: what everyone's best pours add up to, against the next rating;
 * - the leaderboard: the top 3, and you under them if you're further down.
 * Taps open the game in expanded mode. (In code and storage the two modes are still called
 * 'group' and 'personal'.)
 */
import { LEVELS, starsFor } from '../../shared/pour/levels';
import type { DayView, Entry } from '../../shared/protocol';
import { icon, sprite } from '../assets';
import { goalBox } from '../lib/goal';
import './card.css';

export type OpenMode = 'personal' | 'group';

export const el = (tag: string, cls: string, ...kids: Array<Node | string | null>): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids) if (k !== null) e.append(k);
  return e;
};
const img = (src: string, cls = ''): HTMLImageElement => {
  const i = document.createElement('img');
  i.src = src;
  i.alt = '';
  if (cls) i.className = cls;
  return i;
};
const fmt = (n: number): string => n.toLocaleString('en-US');

/** Remember which mode to open; the game screen reads it. */
export function rememberMode(mode: OpenMode): void {
  try {
    localStorage.setItem('ce_mode', mode);
  } catch {
    /* private mode */
  }
}

function localPersonal(): (number | null)[] {
  try {
    return JSON.parse(localStorage.getItem('ce_personal') ?? '[]') as (number | null)[];
  } catch {
    return [];
  }
}

function row(e: Entry, me: boolean): HTMLElement {
  return el('li', me ? 'me' : '', el('b', `rk r${e.rank}`, String(e.rank)), el('span', 'who', `u/${e.username}`), el('b', 'sc', String(e.score)));
}

export function renderCard(root: HTMLElement, v: DayView, open: (e: Event, mode: OpenMode) => void): void {
  root.classList.add('ce-card');
  const closed = !!v.result || v.day.status !== 'OPEN';
  const list = v.result ? v.result.top : v.board;
  const totals = v.result?.totals ?? v.totals;

  // Practice: a small pill in the corner, with your stars once you've started.
  const local = localPersonal();
  const best = LEVELS.map((_, i) => Math.max(v.me.personal[i] ?? -1, local[i] ?? -1));
  const stars = best.reduce((a, b) => a + (b < 0 ? 0 : starsFor(b)), 0);
  const practice = el('button', 'practice', img(sprite('star'), 'st'), el('span', 'pl', 'Practice'), best.some((b) => b >= 0) ? el('span', 'ps', `${stars}/${LEVELS.length * 3}`) : null);
  practice.setAttribute('aria-label', `Practice: ${LEVELS.length} levels to learn the pieces`);
  practice.addEventListener('click', (e) => open(e, 'personal'));

  // The call to action.
  const sub = closed
    ? `Day ${v.day.dayNumber} is closed · watch how to catch them all`
    : v.me.best !== null
      ? `Your best ${v.me.best} · #${v.me.rank ?? '–'} of ${fmt(totals.players)} · beat it`
      : list[0]
        ? `Top score ${list[0].score} · ${fmt(totals.players)} playing`
        : '100 balls · one bucket · same machine for all';
  const label = closed ? 'See the solution' : 'Start the chaos';
  const cta = el('button', 'cta', el('span', 'txt', el('span', 'lbl', label), el('span', 'sub', sub)), el('span', 'play', img(icon('right'))));
  cta.setAttribute('aria-label', `${label}. ${sub}`);
  cta.addEventListener('click', (e) => open(e, 'group'));

  // The leaderboard: the top 3, and you under them if you're further down.
  const rows = list.slice(0, 3).map((e) => row(e, e.username === v.me.username));
  if (v.me.rank && v.me.best !== null && v.me.rank > 3) rows.push(row({ rank: v.me.rank, username: v.me.username ?? 'you', score: v.me.best, at: 0 }, true));
  if (rows.length > 3) root.classList.add('four');
  else root.classList.remove('four');
  const board = el(
    'div',
    'lb',
    el('div', 'lbh', el('span', '', closed ? `Day ${v.day.dayNumber} final` : "Today's leaderboard"), el('span', '', `Day ${v.day.dayNumber}`)),
    rows.length ? el('ol', '', ...rows) : el('div', 'empty', 'Be the first on today’s board'),
  );

  const balls = el('div', 'rain', ...['ball', 'ball_blue', 'ball_green', 'ball_yellow', 'ball_purple', 'ball', 'ball_green', 'ball_blue'].map((b) => img(sprite(b))));
  root.replaceChildren(balls, el('div', 'ce-in', el('div', 'hd', el('div', 'logo', el('b', '', 'Chaos'), el('b', '', 'Engine')), practice), cta, goalBox(totals, closed), board));
}
