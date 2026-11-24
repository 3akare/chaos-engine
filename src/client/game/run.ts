/** The run screen (§7.3): reveal, three runs, tally, awards, your results, replay controls. */
import { parseCell } from '../../shared/coords';
import type { DayResult, StoredPiece } from '../../shared/protocol';
import { daySeed } from '../../shared/rng';
import { boardPieces } from '../../shared/rules/placement';
import { failureTitle } from '../../shared/rules/explain';
import { runDay, type DayRun } from '../../shared/sim/runDay';
import { variantInfo } from '../../shared/sim/variants';
import type { SimResult } from '../../shared/types';
import type { GameApp } from './app';
import type { BoardScene, ScenePiece } from './scenes/BoardScene';
import { closeSheet, h, showSheet } from './ui/dom';
import { pieceIcon } from './ui/icons';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));


export class RunScreen {
  private run!: DayRun;
  private result!: DayResult;
  private ball = 0;
  private speed = 1.2;
  private skip = false;
  private dead = false;
  private banner: HTMLElement;

  constructor(
    private app: GameApp,
    private scene: BoardScene,
    private bar: HTMLElement,
    _status: HTMLElement,
    private board: HTMLElement,
  ) {
    this.banner = h('div', { class: 'run-banner' });
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
    this.renderBar();
    const seenKey = `ce_seen_${v.day.dayId}`;
    let seen = false;
    try {
      seen = localStorage.getItem(seenKey) === '1';
      localStorage.setItem(seenKey, '1');
    } catch {
      /* ignore */
    }
    if (autoplay && !seen) await this.sequence();
    else {
      this.showResults();
    }
  }

  // ---------- the show ----------

  private async sequence(): Promise<void> {
    this.skip = false;
    await this.reveal();
    for (let i = 0; i < 3 && !this.dead; i++) {
      this.ball = i;
      this.renderBar();
      await this.playBall(i, true);
      if (this.dead) return;
      await this.flash(this.ballTitle(i), failureTitle(this.run.balls[i]!), this.run.balls[i]!.end === 'success', 1300);
    }
    if (this.dead) return;
    await this.tally();
    this.showResults();
  }

  private ballTitle(i: number): string {
    const v = this.run.variants[i]!;
    return i === 0 ? 'Your ball' : variantInfo(v).short;
  }


  private async reveal(): Promise<void> {
    const card = (i: number) =>
      h(
        'div',
        { class: 'flip' },
        h('div', { class: 'flip-in' }, h('div', { class: 'face front' }, h('i', { class: 'qball' }), '?'), h('div', { class: 'face back' }, h('b', {}, variantInfo(this.run.variants[i]!).short), h('small', {}, variantInfo(this.run.variants[i]!).effect))),
      );
    const c1 = card(1);
    const c2 = card(2);
    const box = h('div', { class: 'reveal', onclick: () => (this.skip = true) }, h('div', { class: 'reveal-title' }, 'Tonight’s surprise balls'), h('div', { class: 'flips' }, c1, c2));
    this.board.append(box);
    requestAnimationFrame(() => box.classList.add('show'));
    await this.wait(600);
    c1.classList.add('flipped');
    await this.wait(400);
    c2.classList.add('flipped');
    await this.wait(1800);
    box.classList.remove('show');
    await sleep(250);
    box.remove();
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

  private async playBall(i: number, show: boolean, startTick = 0): Promise<void> {
    const r = this.run.balls[i]!;
    const keys = this.keyTicks(r);
    const slow = (tick: number): number => (keys.has(tick) || keys.has(tick + 1) ? 0.35 : 1);
    this.banner.textContent = this.ballTitle(i);
    this.banner.classList.add('show');
    if (show) await sleep(450);
    await this.scene.playRun(r, { speed: this.speed, slowmo: slow, showOwners: true, follow: true, startTick });
    this.banner.classList.remove('show');
  }

  private async flash(title: string, sub: string, good: boolean, ms: number): Promise<void> {
    void title;
    const el = h('div', { class: `flash ${good ? 'good' : 'bad'}` }, good ? '✓' : '✕', h('small', {}, sub));
    this.board.append(el);
    requestAnimationFrame(() => el.classList.add('show'));
    await sleep(ms);
    el.classList.remove('show');
    await sleep(200);
    el.remove();
  }

  private async tally(): Promise<void> {
    const s = this.result.score;
    const el = h('div', { class: `tally ${s >= 2 ? 'good' : ''}` }, h('div', { class: 'score' }, `${s}/3`), h('div', { class: 'balls3 big' }, ...[0, 1, 2].map((k) => h('i', { class: this.run.balls[k]!.end === 'success' ? 'in' : '' }))));
    this.board.append(el);
    requestAnimationFrame(() => el.classList.add('show'));
    if (s > 0) this.confetti(s * 18);
    await sleep(1900);
    el.classList.remove('show');
    await sleep(250);
    el.remove();
  }

  private confetti(n: number): void {
    const colors = ['#ffc95e', '#ff8f8f', '#7ab8ff', '#7fd6a0', '#ff7b5c'];
    for (let i = 0; i < n; i++) {
      const p = h('i', { class: 'confetto' });
      p.style.left = `${(i * 37) % 100}%`;
      p.style.background = colors[i % colors.length]!;
      p.style.animationDelay = `${(i % 10) * 60}ms`;
      p.style.transform = `rotate(${i * 47}deg)`;
      this.board.append(p);
      setTimeout(() => p.remove(), 2600);
    }
  }

  // ---------- controls & results ----------

  private renderBar(): void {
    this.bar.replaceChildren(
      ...[0, 1, 2].map((i) => {
        const b = this.run.balls[i]!;
        return h(
          'button',
          { class: `orb ball-orb ${i === this.ball ? 'on' : ''} ${b.end === 'success' ? 'ok' : 'no'}`, 'aria-label': `Replay ${this.ballTitle(i)}`, onclick: () => void this.replay(i) },
          h('i', { class: 'sphere' }),
          h('span', { class: 'mark' }, b.end === 'success' ? '✓' : '✕'),
        );
      }),
      h('button', { class: 'orb', 'aria-label': 'Results', onclick: () => this.showResults() }, h('span', { class: 'star' }, '★')),
    );
  }

  private async replay(i: number, startTick = 0): Promise<void> {
    closeSheet(true);
    this.ball = i;
    this.renderBar();
    await this.playBall(i, false, startTick);
  }

  private showResults(): void {
    const v = this.app.view;
    const r = this.result;
    const byId = new Map(v.pieces.map((p) => [p.pieceId, p]));
    const award = (icon: string, a: { pieceId: string; username: string } | null) => {
      const p = a ? byId.get(a.pieceId) : undefined;
      if (!a || !p) return null;
      return h('div', { class: 'award' }, h('span', { class: 'aicon' }, icon), pieceIcon(p.type, p.dir, 28), h('b', {}, `u/${a.username}`));
    };
    const cur = v.current;
    const next = cur.postId && cur.postId !== v.day.postId ? h('button', { class: 'pill-btn primary wide', onclick: () => this.app.goToCurrent() }, `Play Day ${cur.dayNumber}`) : null;
    const guessed = v.me.prediction !== null ? h('div', { class: `guessed ${v.me.prediction === r.score ? 'right' : ''}` }, v.me.prediction === r.score ? `You guessed ${r.score}. Spot on!` : `You guessed ${v.me.prediction}.`) : null;
    showSheet(
      h(
        'div',
        { class: 'results' },
        h('div', { class: 'bigscore' }, h('b', {}, `${r.score}/3`), h('div', { class: 'balls3 big' }, ...this.run.balls.map((b) => h('i', { class: b.end === 'success' ? 'in' : '' })))),
        guessed,
        h('div', { class: 'awards' }, award('🏆', r.awards.mvp), r.awards.mostTouched?.pieceId !== r.awards.mvp?.pieceId ? award('👆', r.awards.mostTouched) : null, award('⏱', r.awards.clutch)),
        next,
      ),
      { modal: false },
    );
  }
}
