/**
 * The post in the feed: the game's name, two big buttons (Daily first, then Practice) and one
 * panel under them, whichever matters at that moment:
 * - before you've played today: the community goal, so you see what the subreddit is building
 *   towards and that your pour adds to it;
 * - once you've played: today's leaderboard (top 3 and you), with the community rating in its header;
 * - once the day is over: the final leaderboard.
 * (In code and storage the two modes are still called 'group' and 'personal'.)
 */
import { LEVELS, starsFor } from '../../shared/pour/levels';
import type { DayView, Entry } from '../../shared/protocol';
import { icon, sprite } from '../assets';
import { goalStrip } from '../lib/goal';
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

  // Personal: your progress through the levels.
  const local = localPersonal();
  const best = LEVELS.map((_, i) => Math.max(v.me.personal[i] ?? -1, local[i] ?? -1));
  const totalStars = best.reduce((a, b) => a + (b < 0 ? 0 : starsFor(b)), 0);
  const played = best.some((b) => b >= 0);
  const personalSub = played ? el('span', 'subrow', `${totalStars} / ${LEVELS.length * 3}`, img(sprite('star'), 'st')) : `${LEVELS.length} levels to warm up`;

  // Group: today's machine and where you stand.
  const list = v.result ? v.result.top : v.board;
  const totals = v.result?.totals ?? v.totals;
  const groupSub = closed
    ? `Day ${v.day.dayNumber} is closed · see the solution`
    : v.me.best !== null
      ? `Your best ${v.me.best}${v.me.rank ? ` · #${v.me.rank} of ${fmt(totals.players)}` : ''}`
      : list[0]
        ? `Top score ${list[0].score} · ${fmt(totals.players)} playing`
        : 'One machine, the same for everyone';

  const btn = (mode: OpenMode, label: string, sub: Node | string, ic: string): HTMLElement => {
    const b = el('button', `mode ${mode}`, img(icon(ic), 'ic'), el('span', 'txt', el('span', 'lbl', label), el('span', 'sub', sub)), img(icon('arrowRight'), 'go'));
    b.setAttribute('aria-label', `${label}: ${typeof sub === 'string' ? sub : sub.textContent ?? ''}`);
    b.addEventListener('click', (e) => open(e, mode));
    return b;
  };

  // Under the buttons: the goal before you play, the leaderboard once you have (or the day is over).
  let below: HTMLElement;
  if ((closed || v.me.best !== null) && list.length) {
    // Three rows: the top 3, or the top 2 and you when you're further down.
    const below3 = v.me.rank !== null && v.me.best !== null && v.me.rank > 3;
    const rows = list.slice(0, below3 ? 2 : 3).map((e) => row(e, e.username === v.me.username));
    if (below3) rows.push(row({ rank: v.me.rank!, username: v.me.username ?? 'you', score: v.me.best!, at: 0 }, true));
    const next = totals.tiers.find((t) => totals.balls < t.need);
    const together = totals.tier ? `Together: ${totals.tier}` : closed || !next ? `${fmt(totals.players)} played` : `Together: ${fmt(next.need - totals.balls)} to ${next.name}`;
    root.classList.add('played');
    below = el('div', 'lb', el('div', 'lbh', el('span', '', closed ? `Day ${v.day.dayNumber} final` : "Today's leaderboard"), el('span', '', together)), el('ol', '', ...rows));
  } else {
    root.classList.remove('played');
    below = goalStrip(totals, closed);
  }

  const balls = el('div', 'rain', ...['ball', 'ball_blue', 'ball_green', 'ball_yellow', 'ball_purple', 'ball', 'ball_green', 'ball_blue'].map((b) => img(sprite(b))));
  root.replaceChildren(
    balls,
    el('div', 'logo', el('b', '', 'Chaos'), el('b', '', 'Engine')),
    el('div', 'tag', '100 balls. One bucket. Catch them all.'),
    el('div', 'modes', btn('group', 'Daily', groupSub, 'trophy'), btn('personal', 'Practice', personalSub, 'star')),
    below,
  );
}
