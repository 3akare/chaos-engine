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
    return i === 0 ? 'Your ball' : variantInfo(this.run.variants[i]!).short;
  }

  private async reveal(): Promise<void> {
    const card = (i: number): HTMLElement => {
      const info = variantInfo(this.run.variants[i]!);
      return h(
        'div',
        { class: 'flip' },
        h('div', { class: 'flip-in' }, h('div', { class: 'face front hud' }, '?'), h('div', { class: 'face back' }, spr('ball'), h('b', {}, info.short), h('small', {}, info.effect))),
      );
    };
    const c1 = card(1);
    const c2 = card(2);
    const done = new Promise<void>((resolve) => {
      showCard(h('div', {}, h('h2', {}, 'Tonight’s surprise balls'), h('div', { class: 'flips' }, c1, c2)), null, () => {
        this.skip = true;
        resolve();
      });
    });
    await this.wait(500);
    c1.classList.add('flipped');
    await this.wait(400);
    c2.classList.add('flipped');
    await this.wait(2600);
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
    this.banner.textContent = this.ballTitle(i);
    this.banner.classList.add('show');
    if (show) await sleep(450);
    await this.scene.playRun(r, { speed: this.speed, slowmo: slow, showOwners: true });
    this.banner.classList.remove('show');
  }

  private async stamp(good: boolean): Promise<void> {
    const el = h('div', { class: `stamp ${good ? 'good' : 'bad'}` }, ico(good ? 'checkmark' : 'cross'));
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

  private renderDock(): void {
    const keys = [0, 1, 2].map((i) =>
      h(
        'button',
        {
          class: `key tile${i === this.ball ? ' sel' : ''}`,
          'aria-label': `Replay ${this.ballTitle(i)}`,
          onclick: () => void this.replay(i),
        },
        spr('ball', this.run.balls[i]!.end === 'success' ? '' : 'miss'),
        h('span', { class: `badge ${this.run.balls[i]!.end === 'success' ? 'ok' : 'x'}` }, ico(this.run.balls[i]!.end === 'success' ? 'checkmark' : 'cross')),
      ),
    );
    const star = h('button', { class: 'key blue', 'aria-label': 'Score', onclick: () => this.showResults() }, ico('trophy'));
    this.dock.className = 'dock';
    this.dock.replaceChildren(...keys, star);
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

  private showResults(): void {
    const v = this.app.view;
    const r = this.result;
    const byId = new Map(v.pieces.map((p) => [p.pieceId, p]));
    const who = (label: string, a: { pieceId: string; username: string } | null): HTMLElement | null => {
      const p = a ? byId.get(a.pieceId) : undefined;
      if (!a || !p) return null;
      return h('div', { class: 'who' }, pieceImg(p.type, p.dir), h('b', {}, `u/${a.username}`), h('span', { class: 'lbl' }, label));
    };
    const cur = v.current;
    const hasNext = !!cur.postId && cur.postId !== v.day.postId;
    const guess = v.me.prediction === null ? null : h('p', { class: 'note' }, v.me.prediction === r.score ? `You guessed ${r.score}. Spot on!` : `You guessed ${v.me.prediction}.`);
    const mvp = who('Best piece', r.awards.mvp);
    const clutch = r.awards.clutch && r.awards.clutch.pieceId !== r.awards.mvp?.pieceId ? who('Last save', r.awards.clutch) : null;
    showCard(
      h(
        'div',
        {},
        h('div', { class: 'score hud' }, `${r.score}/3`),
        h('div', { class: 'trio' }, ...this.run.balls.map((b) => spr('ball', b.end === 'success' ? '' : 'miss'))),
        guess,
        mvp,
        clutch,
      ),
      hasNext ? `Play Day ${cur.dayNumber}` : 'Done',
      undefined,
      hasNext ? () => this.app.goToCurrent() : undefined,
    );
  }
}
