/**
 * Rolling the day's three balls, one after another: a name banner, the run, then a star or a cross.
 * Used by Solo (Play), Team (Test) and the nightly result. The dock holds one Skip key meanwhile.
 */
import type { DayRun } from '../../shared/sim/runDay';
import { variantInfo } from '../../shared/sim/variants';
import type { SimResult } from '../../shared/types';
import { BALL_SPRITE } from '../assets';
import type { BoardScene } from './scenes/BoardScene';
import { h, ico, spr } from './ui/dom';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const ballName = (run: DayRun, i: number): string => `${variantInfo(run.variants[i]!).short} ball`;
export const ballSprite = (run: DayRun, i: number): string => BALL_SPRITE[run.variants[i]!];

/** Slow down where it matters: first touches of player pieces, gates, and the last few ticks. */
function keyTicks(r: SimResult, playerPieceIds: ReadonlySet<string>, target: { x: number; y: number }): Set<number> {
  const keys = new Set<number>();
  const first = new Set<string>();
  for (const e of r.events) {
    if (e.kind === 'touch' && e.pieceId && playerPieceIds.has(e.pieceId) && !first.has(e.pieceId)) {
      first.add(e.pieceId);
      keys.add(e.tick);
    }
    if (e.kind === 'gate' || e.kind === 'checkpoint') keys.add(e.tick);
  }
  r.frames.forEach((f, i) => {
    if (r.end !== 'success' && Math.abs(f.x - target.x) <= 1 && Math.abs(f.y - target.y) <= 1) keys.add(i);
  });
  for (let i = Math.max(0, r.frames.length - 3); i < r.frames.length; i++) keys.add(i);
  return keys;
}

export type RollOptions = {
  scene: BoardScene;
  board: HTMLElement;
  dock: HTMLElement;
  speed?: number;
  /** Ids of pieces players placed (slow-motion on their first touch). */
  playerPieceIds?: ReadonlySet<string>;
  target: { x: number; y: number };
  showOwners?: boolean;
};

/** Roll all three balls. Resolves when done or skipped. */
export async function rollThree(run: DayRun, o: RollOptions): Promise<void> {
  let skipped = false;
  const banner = h('div', { class: 'banner' });
  o.board.append(banner);
  o.dock.className = 'dock';
  o.dock.replaceChildren(
    h(
      'button',
      {
        class: 'key wide hud',
        'aria-label': 'Skip',
        onclick: () => {
          skipped = true;
          o.scene.stop();
        },
      },
      'Skip',
    ),
  );
  try {
    for (let i = 0; i < 3 && !skipped; i++) {
      const r = run.balls[i]!;
      const keys = keyTicks(r, o.playerPieceIds ?? new Set(), o.target);
      banner.replaceChildren(spr(ballSprite(run, i)), ballName(run, i));
      banner.classList.add('show');
      await sleep(350);
      if (skipped) break;
      await o.scene.playRun(r, { speed: o.speed ?? 1.6, slowmo: (t) => (keys.has(t) || keys.has(t + 1) ? 0.4 : 1), showOwners: o.showOwners ?? false, ball: ballSprite(run, i) });
      banner.classList.remove('show');
      if (skipped) break;
      await stamp(o.board, r.end === 'success');
    }
  } finally {
    banner.remove();
  }
}

async function stamp(board: HTMLElement, good: boolean): Promise<void> {
  const el = h('div', { class: `stamp ${good ? 'good' : 'bad'}` }, good ? spr('star') : ico('cross'));
  board.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  await sleep(700);
  el.classList.remove('show');
  await sleep(180);
  el.remove();
}

/** Three stars, filled for each ball that made it. */
export function starRow(run: DayRun): HTMLElement {
  return h(
    'div',
    { class: 'stars' },
    ...run.balls.map((b, i) => {
      const s = spr('star', b.end === 'success' ? '' : 'miss');
      s.style.animationDelay = `${120 + i * 200}ms`;
      return s;
    }),
  );
}

/** The three balls with a star or cross each. */
export function ballRow(run: DayRun): HTMLElement {
  return h(
    'div',
    { class: 'trio' },
    ...run.balls.map((b, i) => h('span', { class: 'tb' }, spr(ballSprite(run, i), b.end === 'success' ? '' : 'miss'), h('i', { class: b.end === 'success' ? 'ok' : 'x' }, b.end === 'success' ? spr('star') : ico('cross')))),
  );
}

export const scoreTitle = (score: number): string => (score === 3 ? 'Perfect!' : score === 2 ? 'So close!' : score === 1 ? 'One made it' : 'No stars yet');

export function confetti(board: HTMLElement, n: number): void {
  for (let i = 0; i < n; i++) {
    const p = spr(i % 3 ? 'star' : 'coin', 'confetto');
    p.style.left = `${(i * 37) % 100}%`;
    p.style.animationDelay = `${(i % 10) * 60}ms`;
    board.append(p);
    setTimeout(() => p.remove(), 2600);
  }
}
