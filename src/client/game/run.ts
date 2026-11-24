/** After the night's run: reveal the surprise balls, play all three, show the score. The dock holds replay keys. */
import { parseCell } from '../../shared/coords';
import type { DayResult, StoredPiece } from '../../shared/protocol';
import { daySeed } from '../../shared/rng';
import { boardPieces } from '../../shared/rules/placement';
import { runDay, type DayRun } from '../../shared/sim/runDay';
import { variantInfo } from '../../shared/sim/variants';
import type { SimResult } from '../../shared/types';
import type { GameApp } from './app';
import type { BoardScene, ScenePiece } from './scenes/BoardScene';
import { BALL_SPRITE } from '../assets';
import { closeCard, h, ico, pieceImg, showCard, spr } from './ui/dom';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class RunScreen {
  private run!: DayRun;
  private result!: DayResult;
  private ball = -1;
  private speed = 1.2;
  private skip = false;
  private dead = false;
  private banner: HTMLElement;

  constructor(
    private app: GameApp,
    private scene: BoardScene,
    private dock: HTMLElement,
    private board: HTMLElement,
  ) {
    this.banner = h('div', { class: 'banner' });
    this.board.append(this.banner);
  }

  destroy(): void {
    this.dead = true;
    this.banner.remove();
    this.scene.stop();
  }

  private scenePieces(): ScenePiece[] {
    const me = this.app.view.me.userId;
    return this.app.view.pieces.map((p) => {
      const c = parseCell(p.socket)!;
      return { id: p.pieceId, type: p.type, dir: p.dir, x: c[0], y: c[1], owner: p.username, setup: p.setup === true, mine: p.userId === me && !p.setup };
    });
  }

  async start(autoplay: boolean): Promise<void> {
    const v = this.app.view;
    this.result = v.result!;
    const pieces: Record<string, StoredPiece> = {};
    for (const p of v.pieces) pieces[p.socket] = p;
    this.run = runDay({ level: this.app.level, pieces: boardPieces(pieces) }, daySeed(v.day.dayId, this.result.revealedSecret));
    this.scene.setBoard(this.app.level, this.scenePieces(), v.level.target ?? 'bell');
    this.scene.setGhost(undefined, undefined);
    const seenKey = `ce_seen_${v.day.dayId}`;
    let seen = false;
    try {
      seen = localStorage.getItem(seenKey) === '1';
      localStorage.setItem(seenKey, '1');
    } catch {
      /* private mode */
    }
    if (autoplay && !seen) {
      this.dock.replaceChildren();
      await this.sequence();
    } else {
      this.renderDock();
      this.showResults();
    }
  }

  // ---------- the show ----------

  private async sequence(): Promise<void> {
    this.skip = false;
    await this.reveal();
    for (let i = 0; i < 3 && !this.dead; i++) {
      this.ball = i;
      this.renderDock();
      await this.playBall(i, true);
      if (this.dead) return;
      await this.stamp(this.run.balls[i]!.end === 'success');
    }
    if (this.dead) return;
    this.ball = -1;
    this.renderDock();
    if (this.result.score > 0) this.confetti(this.result.score * 18);
    this.showResults();
  }

  private ballTitle(i: number): string {
    return `${variantInfo(this.run.variants[i]!).short} ball`;
  }
  private ballSprite(i: number): string {
    return BALL_SPRITE[this.run.variants[i]!];
  }

  /** Tonight's three balls: red, then two surprise balls that flip over. */
  private async reveal(): Promise<void> {
    const card = (i: number): HTMLElement => {
      const info = variantInfo(this.run.variants[i]!);
      const back = h('div', { class: 'face back' }, spr(this.ballSprite(i)), h('b', {}, info.short), h('small', {}, info.effect));
      if (i === 0) return h('div', { class: 'flip flipped' }, h('div', { class: 'flip-in' }, h('div', { class: 'face front' }), back));
      return h('div', { class: 'flip' }, h('div', { class: 'flip-in' }, h('div', { class: 'face front hud' }, '?'), back));
    };
    const cards = [0, 1, 2].map(card);
    const done = new Promise<void>((resolve) => {
      showCard(h('div', {}, h('h2', {}, 'Tonight’s 3 balls'), h('div', { class: 'flips' }, ...cards), h('p', { class: 'note' }, 'Each one that reaches the flag is a star')), null, () => {
        this.skip = true;
        resolve();
      });
    });
    await this.wait(700);
    cards[1]!.classList.add('flipped');
    await this.wait(450);
    cards[2]!.classList.add('flipped');
    await this.wait(3000);
    closeCard();
    this.skip = true;
    await Promise.race([done, sleep(250)]);
    this.skip = false;
  }

  private async wait(ms: number): Promise<void> {
    const end = Date.now() + ms;
    while (Date.now() < end && !this.skip && !this.dead) await sleep(40);
  }

  private keyTicks(r: SimResult): Set<number> {
    const keys = new Set<number>();
    const firstTouch = new Set<string>();
    const playerIds = new Set(this.app.view.pieces.filter((p) => !p.setup).map((p) => p.pieceId));
    for (const e of r.events) {
      if (e.kind === 'touch' && e.pieceId && playerIds.has(e.pieceId) && !firstTouch.has(e.pieceId)) {
        firstTouch.add(e.pieceId);
        keys.add(e.tick);
      }
      if (e.kind === 'gate' || e.kind === 'checkpoint') keys.add(e.tick);
    }
    const t = this.app.level.target;
    r.frames.forEach((f, i) => {
      if (r.end !== 'success' && Math.abs(f.x - t.x) <= 1 && Math.abs(f.y - t.y) <= 1) keys.add(i);
    });
    for (let i = Math.max(0, r.frames.length - 3); i < r.frames.length; i++) keys.add(i);
    return keys;
  }

  private async playBall(i: number, show: boolean): Promise<void> {
    const r = this.run.balls[i]!;
    const keys = this.keyTicks(r);
    const slow = (tick: number): number => (keys.has(tick) || keys.has(tick + 1) ? 0.35 : 1);
    this.banner.replaceChildren(spr(this.ballSprite(i)), this.ballTitle(i));
    this.banner.classList.add('show');
    if (show) await sleep(450);
    await this.scene.playRun(r, { speed: this.speed, slowmo: slow, showOwners: true, ball: this.ballSprite(i) });
    this.banner.classList.remove('show');
  }

  private async stamp(good: boolean): Promise<void> {
    const el = h('div', { class: `stamp ${good ? 'good' : 'bad'}` }, good ? spr('star') : ico('cross'));
    this.board.append(el);
    requestAnimationFrame(() => el.classList.add('show'));
    await sleep(1000);
    el.classList.remove('show');
    await sleep(220);
    el.remove();
  }

  private confetti(n: number): void {
    for (let i = 0; i < n; i++) {
      const p = spr(i % 3 ? 'star' : 'coin', 'confetto');
      p.style.left = `${(i * 37) % 100}%`;
      p.style.animationDelay = `${(i % 10) * 60}ms`;
      this.board.append(p);
      setTimeout(() => p.remove(), 2600);
    }
  }

  // ---------- dock & results ----------

  /** Replay keys: one per ball (its colour, ⭐ or ✕), then the result. */
  private renderDock(): void {
    const keys = [0, 1, 2].map((i) => {
      const ok = this.run.balls[i]!.end === 'success';
      return h(
        'button',
        { class: `key ballkey${i === this.ball ? ' sel' : ''}`, 'aria-label': `Replay the ${this.ballTitle(i)}`, onclick: () => void this.replay(i) },
        spr(this.ballSprite(i)),
        h('span', { class: `badge ${ok ? 'star' : 'x'}` }, ok ? spr('star') : ico('cross')),
      );
    });
    const res = h('button', { class: 'key blue', 'aria-label': 'Tonight’s result', onclick: () => this.showResults() }, spr('star', 'big'));
    this.dock.className = 'dock';
    this.dock.replaceChildren(...keys, res);
  }

  private async replay(i: number): Promise<void> {
    if (this.scene.isPlaying()) this.scene.stop();
    closeCard();
    this.ball = i;
    this.renderDock();
    await this.playBall(i, false);
    if (this.ball === i) {
      this.ball = -1;
      this.renderDock();
    }
  }

  /** The night's result: one star per ball that reached the flag. */
  private showResults(): void {
    const v = this.app.view;
    const r = this.result;
    const byId = new Map(v.pieces.map((p) => [p.pieceId, p]));
    const who = (label: string, a: { pieceId: string; username: string } | null): HTMLElement | null => {
      const p = a ? byId.get(a.pieceId) : undefined;
      if (!a || !p) return null;
      return h('div', { class: 'who' }, pieceImg(p.type, p.dir), h('span', { class: 'nm' }, h('b', {}, `u/${a.username}`), h('span', { class: 'lbl' }, label)));
    };
    const cur = v.current;
    const hasNext = !!cur.postId && cur.postId !== v.day.postId;
    const title = r.score === 3 ? 'Perfect!' : r.score === 2 ? 'Great run!' : r.score === 1 ? 'One made it' : 'No stars tonight';
    const stars = h(
      'div',
      { class: 'stars' },
      ...this.run.balls.map((b, i) => {
        const s = spr('star', b.end === 'success' ? '' : 'miss');
        s.style.animationDelay = `${150 + i * 220}ms`;
        return s;
      }),
    );
    const balls = h(
      'div',
      { class: 'trio' },
      ...this.run.balls.map((b, i) => h('span', { class: 'tb' }, spr(this.ballSprite(i), b.end === 'success' ? '' : 'miss'), h('i', { class: b.end === 'success' ? 'ok' : 'x' }, b.end === 'success' ? spr('star') : ico('cross')))),
    );
    const mvp = who('Most helpful piece', r.awards.mvp);
    showCard(
      h('div', {}, h('h2', {}, title), stars, balls, mvp),
      hasNext ? `Play Day ${cur.dayNumber}` : 'OK',
      undefined,
      hasNext ? () => this.app.goToCurrent() : undefined,
    );
  }
}
