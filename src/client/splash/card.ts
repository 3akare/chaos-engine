/** The feed card: an inline render of a Day for the splash and the browser demo. No Phaser. */
import type { DayView } from '../../shared/protocol';
import { levelOf } from '../../shared/sim/board';
import { ball1 } from '../../shared/rules/placement';
import { drawMini } from '../lib/miniBoard';
import './card.css';

export const el = (tag: string, cls: string, ...kids: Array<Node | string>): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.append(...kids);
  return e;
};

function countdown(ms: number): string {
  if (ms <= 0) return 'Firing now';
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${String(m % 60).padStart(2, '0')}m left` : `${m}m left`;
}

export function renderCard(root: HTMLElement, v: DayView, open: (e: Event) => void): void {
  root.classList.add('ce-card');
  const level = levelOf({ ...v.level, solution: [] });
  const pieces: Record<string, (typeof v.pieces)[number]> = {};
  for (const p of v.pieces) pieces[p.socket] = p;
  const run = ball1(level, pieces);
  const resolved = v.result !== null;

  const canvas = document.createElement('canvas');
  const mini = el('div', 'mini', canvas);
  mini.addEventListener('click', open);
  const info = el('div', 'info');
  info.append(el('div', 'brand', 'Chaos Engine'), el('div', 'title', `Day ${v.day.dayNumber}`));
  const cta = (label: string): void => {
    const b = el('button', 'cta', label);
    b.addEventListener('click', open);
    info.append(el('div', 'spacer'), b);
  };
  if (resolved) {
    const r = v.result!;
    info.append(el('div', 'score', `${r.score}/3`), el('div', 'balls3', ...r.perBall.map((b) => el('i', b.end === 'success' ? 'in' : ''))));
    cta('Watch');
  } else if (v.day.status !== 'OPEN') {
    info.append(el('div', 'muted', 'Firing…'));
    cta('Watch');
  } else {
    info.append(el('div', 'muted', countdown(v.day.locksAt - v.serverNow)));
    cta('Play');
  }
  root.replaceChildren(mini, info);
  // Size the preview from the card's height (CSS aspect-ratio collapses inside a flex row here).
  const fit = (): void => {
    const hgt = mini.clientHeight || root.clientHeight - 28;
    mini.style.width = `${Math.min(root.clientWidth * 0.48, Math.floor((hgt * 9) / 14.4))}px`;
  };
  fit();
  requestAnimationFrame(() =>
    (fit(), drawMini)(canvas, v.level.rows, {
      pieces: v.pieces,
      path: resolved ? [] : run.frames,
      pathColor: '#ff7b5c',
      target: v.level.target ?? 'bell',
    }),
  );
}
