/** The feed card: an inline render of a Day for the splash and the browser demo. No Phaser. */
import type { DayView } from '../../shared/protocol';
import { sprite } from '../assets';
import { drawMini } from '../lib/miniBoard';
import './card.css';

export const el = (tag: string, cls: string, ...kids: Array<Node | string>): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.append(...kids);
  return e;
};

export type OpenMode = 'solo' | 'team';

/** Remember which mode to open (the game screen reads it), then open the game. */
export function rememberMode(mode: OpenMode): void {
  try {
    localStorage.setItem('ce_mode', mode);
  } catch {
    /* private mode */
  }
}

const starImgs = (n: number | null): HTMLElement =>
  el(
    'span',
    'stars',
    ...[0, 1, 2].map((i) => {
      const img = document.createElement('img');
      img.src = sprite('star');
      img.alt = '';
      if (n === null || i >= n) img.className = 'miss';
      return img;
    }),
  );

/** The post in the feed: the game's name, today's machine, and two ways to play. */
export function renderCard(root: HTMLElement, v: DayView, open: (e: Event, mode: OpenMode) => void): void {
  root.classList.add('ce-card');
  const canvas = document.createElement('canvas');
  const mini = el('div', 'mini', canvas);
  mini.addEventListener('click', (e) => open(e, 'solo'));

  const btn = (mode: OpenMode, label: string, sub: Node | string): HTMLElement => {
    const b = el('button', `mode ${mode}`, el('span', 'lbl', label), el('span', 'sub', sub));
    b.setAttribute('aria-label', `${label} play`);
    b.addEventListener('click', (e) => open(e, mode));
    return b;
  };
  const best = v.solo?.best ?? null;
  const soloSub: Node | string = best === null ? 'Build it yourself' : el('span', 'row', 'Your best ', starImgs(best));
  let teamSub: Node | string;
  if (v.result) teamSub = el('span', 'row', 'Team got ', starImgs(v.result.score));
  else if (v.day.status !== 'OPEN') teamSub = 'Rolling now…';
  else {
    const n = v.counts.builders;
    const hrs = Math.max(0, Math.floor((v.day.locksAt - v.serverNow) / 3_600_000));
    teamSub = n === 0 ? `Rolls in ${hrs}h` : `${n} building · ${hrs}h left`;
  }
  const info = el(
    'div',
    'info',
    el('div', 'title hud', 'Chaos Engine'),
    el('div', 'kicker', `Build of the Day #${v.day.dayNumber}`),
    el('div', 'spacer'),
    btn('solo', 'Solo', soloSub),
    btn('team', 'Team', teamSub),
  );
  root.replaceChildren(mini, info);
  // Size the preview from the card's height (CSS aspect-ratio collapses inside a flex row here).
  const fit = (): void => {
    const hgt = mini.clientHeight || root.clientHeight - 32;
    mini.style.width = `${Math.min(root.clientWidth * 0.46, Math.floor((hgt * 9) / 14))}px`;
  };
  fit();
  requestAnimationFrame(() => {
    fit();
    drawMini(canvas, v.level.rows, { target: v.level.target ?? 'bell' });
  });
}
