/** The feed card: an inline render of a Day for the splash and the browser demo. No Phaser. */
import type { DayView } from '../../shared/protocol';
import { levelOf } from '../../shared/sim/board';
import { ball1 } from '../../shared/rules/placement';
import { describeEnd } from '../../shared/rules/explain';
import { variantInfo } from '../../shared/sim/variants';
import { circled } from '../../shared/coords';
import { drawMini } from '../lib/miniBoard';
import './card.css';

export const el = (tag: string, cls: string, ...kids: Array<Node | string>): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.append(...kids);
  return e;
};

function countdown(ms: number): string {
  if (ms <= 0) return 'Locking now';
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  return h > 0 ? `Locks in ${h}h ${String(m % 60).padStart(2, '0')}m` : `Locks in ${m}m`;
}

export function renderCard(root: HTMLElement, v: DayView, open: (e: Event) => void): void {
  root.classList.add('ce-card');
  const level = levelOf({ ...v.level, solution: [] });
  const pieces: Record<string, (typeof v.pieces)[number]> = {};
  for (const p of v.pieces) pieces[p.socket] = p;
  const run = ball1(level, pieces);
  const resolved = v.result !== null;
  const tier = v.level.gen?.tier ?? 1;
  const goal = `${v.level.target === 'basket' ? '🧺 Fill the basket' : '🔔 Ring the bell'}${v.level.objective.type === 'CHECKPOINTS_THEN_DELIVER' ? ` via ${Array.from({ length: v.level.objective.count }, (_, i) => circled(i + 1)).join('')}` : ''}`;

  const canvas = document.createElement('canvas');
  const mini = el('div', 'mini', canvas);
  mini.addEventListener('click', open);
  const info = el('div', 'info');
  info.append(el('div', 'brand', 'Chaos Engine'), el('div', 'title', `Day ${v.day.dayNumber} · ${v.level.name} `, el('span', 'gears', '⚙'.repeat(tier))));

  if (resolved) {
    const r = v.result!;
    info.append(el('div', 'score', `${r.score} / 3`, el('small', '', ' delivered')));
    info.append(el('div', 'tag', 'The secret balls were'));
    info.append(el('div', 'vars', el('span', 'var', variantInfo(r.variants[1]).short), el('span', 'var', variantInfo(r.variants[2]).short)));
    if (r.awards.mvp) info.append(el('div', 'chip', `🏆 MVP u/${r.awards.mvp.username}`));
    info.append(el('div', 'muted', `${r.builders} engineers · streak ${r.streak}`));
    info.append(el('div', 'spacer'));
    const b = el('button', 'cta', '▶ Watch the run');
    b.addEventListener('click', open);
    info.append(b);
  } else if (v.day.status !== 'OPEN') {
    info.append(el('div', 'chip', '⚙️ Firing up the machine…'));
    info.append(el('div', 'muted', 'Three balls are rolling. Results in a moment.'));
    info.append(el('div', 'spacer'));
    const b = el('button', 'cta', 'Watch');
    b.addEventListener('click', open);
    info.append(b);
  } else {
    const sockets = level.socket.filter(Boolean).length;
    info.append(el('div', 'muted', goal));
    info.append(el('div', 'chip', `⏱ ${countdown(v.day.locksAt - v.serverNow)}`));
    info.append(el('div', 'muted', `${v.counts.builders} ${v.counts.builders === 1 ? 'engineer' : 'engineers'} · ${v.pieces.length}/${sockets} sockets filled`));
    info.append(el('div', `chip ${run.end === 'success' ? 'good' : 'bad'}`, run.end === 'success' ? 'Right now: Ball 1 delivers ✓' : `Right now: Ball 1 ${describeEnd(run)}`));
    if (v.yesterday) info.append(el('div', 'muted', `Yesterday: ${v.yesterday.score}/3 delivered`));
    info.append(el('div', 'spacer'));
    const b = el('button', 'cta', v.me.sockets.length ? 'Check your pieces' : 'Build');
    b.addEventListener('click', open);
    info.append(b);
  }
  root.replaceChildren(mini, info);
  requestAnimationFrame(() =>
    drawMini(canvas, v.level.rows, {
      pieces: v.pieces,
      path: resolved ? [] : run.frames,
      pathColor: run.end === 'success' ? '#1f8f58' : '#e5484d',
      target: v.level.target ?? 'bell',
    }),
  );
}

