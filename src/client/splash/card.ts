/**
 * The post in the feed: today's machine pouring live, an arcade scoreboard (today's best, you,
 * the subreddit's goal) and one Play button. After the day closes it pours the winning build.
 */
import type { DayView } from '../../shared/protocol';
import { icon } from '../assets';
import { artReady, livePour } from '../pour/draw';
import './card.css';

export const el = (tag: string, cls: string, ...kids: Array<Node | string | null>): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids) if (k !== null) e.append(k);
  return e;
};
const fmt = (n: number): string => n.toLocaleString('en-US');

/** A scoreboard entry: label, big number, a line under it. With no number, the line takes its place. */
function stat(label: string, value: number | null, sub: string, cls = ''): HTMLElement {
  return el('div', `stat ${cls}`, el('div', 'k', label), value === null ? el('div', 'none', sub) : el('div', 'v', String(value)), value === null ? null : el('div', 's', sub));
}

export function renderCard(root: HTMLElement, v: DayView, open: (e: Event) => void): void {
  root.classList.add('ce-card');
  const closed = !!v.result || v.day.status !== 'OPEN';
  const list = v.result ? v.result.top : v.board;
  const lead = list[0] ?? null;
  const totals = v.result?.totals ?? v.totals;
  const players = totals.players;

  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-label', closed ? 'The winning build pouring' : "Today's machine pouring");
  const screen = el('div', 'screen', canvas, el('div', 'tag', closed && v.result?.winner ? 'Winning build' : 'No pieces yet'));
  screen.addEventListener('click', open);

  const best = stat(closed ? 'Winner' : "Today's best", lead?.score ?? null, lead ? `u/${lead.username}` : closed ? 'Nobody played' : 'Be the first!', 'hi');
  const chasers = list.length > 1 ? el('ol', 'chasers', ...list.slice(1, 3).map((e) => el('li', '', el('b', '', String(e.rank)), el('span', '', `u/${e.username}`), el('b', '', String(e.score))))) : null;
  const you = stat('You', v.me.best, v.me.rank ? `#${v.me.rank} of ${fmt(players)}` : closed ? 'Didn’t play' : 'Not played yet');
  const pct = Math.min(100, Math.round((totals.balls / Math.max(1, totals.goal)) * 100));
  const fill = el('div', 'fill');
  fill.style.width = `${pct}%`;
  const together = el('div', `stat goal${pct >= 100 ? ' full' : ''}`, el('div', 'k', 'Together'), el('div', 'g', `${fmt(totals.balls)}`, el('span', '', ` / ${fmt(totals.goal)}`)), el('div', 'track', fill));
  const board = el('div', 'sb', best, chasers, you, together);

  const label = closed ? (v.result?.winner ? 'Watch the winner' : 'See the results') : v.me.best === null ? 'Play' : v.me.best >= 100 ? 'Play again' : 'Beat your best';
  const img = document.createElement('img');
  img.src = icon(closed ? 'trophy' : 'right');
  img.alt = '';
  const play = el('button', 'play', img, label);
  play.addEventListener('click', open);

  const head = el('div', 'head', el('div', 'logo', el('b', '', 'Chaos'), el('b', '', 'Engine')), el('div', 'day', el('span', '', `Day ${v.day.dayNumber}`), el('i', '', v.machine.name)));
  const hook = el('div', 'hook', closed ? 'Final scores' : 'Catch all 100 balls');
  root.replaceChildren(head, el('div', 'mid', screen, el('div', 'side', hook, board)), play);

  // The screen keeps the board's 3:5 shape, sized from the space it has.
  const fit = (): void => {
    const h = screen.parentElement!.clientHeight;
    screen.style.width = `${Math.min(Math.floor((h * 3) / 5), Math.floor(root.clientWidth * 0.45))}px`;
  };
  fit();
  new ResizeObserver(fit).observe(root);
  void artReady().then(() => livePour(canvas, v.machine, closed ? (v.result?.winner?.build ?? []) : []));
}
