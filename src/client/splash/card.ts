/** The post in the feed: today's machine, the top three, your rank, the shared goal, and Play. */
import type { DayView } from '../../shared/protocol';
import { icon } from '../assets';
import { artReady, drawStill } from '../pour/draw';
import './card.css';

export const el = (tag: string, cls: string, ...kids: Array<Node | string | null>): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids) if (k !== null) e.append(k);
  return e;
};
const fmt = (n: number): string => n.toLocaleString('en-US');

function top3(v: DayView): HTMLElement {
  const list = v.result ? v.result.top : v.board;
  if (!list.length) return el('div', 'empty', v.result ? 'Nobody poured on this one.' : 'Nobody has poured yet. Be the first!');
  return el(
    'ol',
    'top3',
    ...list.slice(0, 3).map((e) => el('li', e.username === v.me.username ? 'me' : '', el('span', `medal m${e.rank}`, String(e.rank)), el('span', 'who', `u/${e.username}`), el('b', '', String(e.score)))),
  );
}

function meter(v: DayView): HTMLElement {
  const t = v.result?.totals ?? v.totals;
  const pct = Math.min(100, Math.round((t.balls / Math.max(1, t.goal)) * 100));
  const fill = el('div', 'fill');
  fill.style.width = `${pct}%`;
  return el('div', `meter${pct >= 100 ? ' full' : ''}`, el('div', 'lbl', el('span', '', 'Together'), el('b', '', `${fmt(t.balls)} / ${fmt(t.goal)}`)), el('div', 'track', fill));
}

export function renderCard(root: HTMLElement, v: DayView, open: (e: Event) => void): void {
  root.classList.add('ce-card');
  const canvas = document.createElement('canvas');
  const mini = el('div', 'mini', canvas);
  mini.addEventListener('click', open);
  const closed = !!v.result || v.day.status !== 'OPEN';
  const me = v.me.best !== null ? el('div', 'mine', 'Your best ', el('b', '', String(v.me.best)), v.me.rank ? ` · #${v.me.rank}` : '') : null;
  const play = el('button', 'play', el('img', ''), closed ? (v.result?.winner ? 'Watch the winner' : 'See the board') : v.me.best === null ? 'Play' : 'Beat it');
  (play.firstChild as HTMLImageElement).src = icon(closed ? 'trophy' : 'right');
  (play.firstChild as HTMLImageElement).alt = '';
  play.addEventListener('click', open);
  const kicker = el('div', 'kicker', `Day ${v.day.dayNumber} · ${v.machine.name}`);
  const info = el('div', 'info', el('div', 'title hud', 'Chaos Engine'), kicker, el('div', 'sub', closed ? 'Final board' : 'Catch all 100 balls'), top3(v), me, el('div', 'spacer'), meter(v), play);
  root.replaceChildren(mini, info);
  const fit = (): void => {
    const hgt = mini.clientHeight || root.clientHeight - 28;
    mini.style.width = `${Math.min(root.clientWidth * 0.42, Math.floor((hgt * 3) / 5))}px`;
  };
  fit();
  void artReady().then(() =>
    requestAnimationFrame(() => {
      fit();
      drawStill(canvas, v.machine, v.result?.winner?.build ?? []);
    }),
  );
}
