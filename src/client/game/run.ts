/** The run screen (§7.3): reveal, three runs, tally, awards, your results, replay controls. */
import { parseCell } from '../../shared/coords';
import type { DayResult, StoredPiece } from '../../shared/protocol';
import { daySeed } from '../../shared/rng';
import { boardPieces, pieceName } from '../../shared/rules/placement';
import { failureTitle } from '../../shared/rules/explain';
import { runDay, type DayRun } from '../../shared/sim/runDay';
import { variantInfo } from '../../shared/sim/variants';
import { sha256Hex } from '../../shared/sha256';
import { minutesBefore } from '../../shared/results';
import type { SimResult } from '../../shared/types';
import type { GameApp } from './app';
import type { BoardScene, ScenePiece } from './scenes/BoardScene';
import { closeSheet, h, showSheet } from './ui/dom';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Moment = { ball: number; tick: number; label: string };

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
    private status: HTMLElement,
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
      this.status.textContent = `Day ${v.day.dayNumber}: ${this.result.score} of 3 balls made it`;
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
    return i === 0 ? 'Ball 1 · Your ball' : `Ball ${i + 1} · Surprise: ${variantInfo(v).short}`;
  }

  private shortName(i: number): string {
    return i === 0 ? 'Your ball' : variantInfo(this.run.variants[i]!).short;
  }

  private async reveal(): Promise<void> {
    const v = this.app.view;
    const ok = sha256Hex(this.result.revealedSecret) === v.day.commitHash;
    const card = (i: number) =>
      h(
        'div',
        { class: 'flip' },
        h('div', { class: 'flip-in' }, h('div', { class: 'face front' }, `Surprise ball ${i}`, h('small', {}, '?')), h('div', { class: 'face back' }, `Surprise ball ${i}`, h('b', {}, variantInfo(this.run.variants[i]!).short), h('small', {}, variantInfo(this.run.variants[i]!).effect))),
      );
    const seal = h('div', { class: 'seal' }, '🔒');
    const hash = h('div', { class: 'reveal-hash' }, 'Three balls are about to fire: yours, and two surprises.');
    const c1 = card(1);
    const c2 = card(2);
    const box = h('div', { class: 'reveal', onclick: () => (this.skip = true) }, h('div', { class: 'reveal-title' }, `Day ${v.day.dayNumber} · The big run`), seal, hash, h('div', { class: 'flips' }, c1, c2), h('small', { class: 'tapskip' }, 'tap to skip'));
    this.board.append(box);
    requestAnimationFrame(() => box.classList.add('show'));
    await this.wait(700);
    seal.textContent = '🔓';
    seal.classList.add('open');
    hash.textContent = ok ? 'Here are today’s surprise balls. They were locked in at the start of the day.' : 'Here are today’s surprise balls.';
    await this.wait(600);
    c1.classList.add('flipped');
    await this.wait(450);
    c2.classList.add('flipped');
    await this.wait(1500);
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
    this.status.textContent = i === 0 ? 'The same ball you tested with.' : `Twist: ${variantInfo(this.run.variants[i]!).effect}`;
    if (show) await sleep(450);
    await this.scene.playRun(r, { speed: this.speed, slowmo: slow, showOwners: true, follow: true, startTick });
    this.banner.classList.remove('show');
  }

  private async flash(title: string, sub: string, good: boolean, ms: number): Promise<void> {
    const el = h('div', { class: `flash ${good ? 'good' : 'bad'}` }, h('small', {}, title), sub);
    this.board.append(el);
    requestAnimationFrame(() => el.classList.add('show'));
    await sleep(ms);
    el.classList.remove('show');
    await sleep(200);
    el.remove();
  }

  private async tally(): Promise<void> {
    const s = this.result.score;
    const title = s === 3 ? 'Perfect machine!' : s === 0 ? 'The machine wins today' : s === 2 ? 'So close!' : 'One made it';
    const el = h('div', { class: `tally ${s >= 2 ? 'good' : ''}` }, h('div', { class: 'score' }, `${s} / 3`), h('div', {}, 'made it'), h('b', {}, title));
    this.board.append(el);
    requestAnimationFrame(() => el.classList.add('show'));
    if (s > 0) this.confetti(s * 18);
    await sleep(1900);
    el.classList.remove('show');
    await sleep(250);
    el.remove();
    this.status.textContent = `Day ${this.app.view.day.dayNumber}: ${s} of 3 balls made it`;
  }

  private confetti(n: number): void {
    const colors = ['#f6c945', '#f28c28', '#2f6fdb', '#e5484d', '#2fa36b'];
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
    const seg = h(
      'div',
      { class: 'seg', role: 'tablist' },
      ...[0, 1, 2].map((i) => {
        const b = this.run.balls[i]!;
        return h(
          'button',
          { class: `${i === this.ball ? 'on' : ''} ${b.end === 'success' ? 'ok' : 'no'}`, role: 'tab', 'aria-label': this.ballTitle(i), onclick: () => void this.replay(i) },
          h('i', { class: 'dotball' }),
          h('span', {}, b.end === 'success' ? '✓' : '✗'),
        );
      }),
    );
    this.bar.replaceChildren(
      h('button', { class: 'round side', 'aria-label': 'Replay', onclick: () => void this.replay(this.ball) }, h('span', { class: 'glyph' }, '↻'), h('span', { class: 'lbl' }, 'replay')),
      seg,
      h('button', { class: 'round side', 'aria-label': 'Results', onclick: () => this.showResults() }, h('span', { class: 'glyph' }, '★'), h('span', { class: 'lbl' }, 'results')),
    );
  }


  private async replay(i: number, startTick = 0): Promise<void> {
    closeSheet(true);
    this.ball = i;
    this.renderBar();
    await this.playBall(i, false, startTick);
    this.status.textContent = `${this.ballTitle(i)}: ${failureTitle(this.run.balls[i]!)}`;
  }

  private moments(): Moment[] {
    const out: Moment[] = [];
    const byId = new Map(this.app.view.pieces.map((p) => [p.pieceId, p]));
    this.run.balls.forEach((r, b) => {
      const seen = new Set<string>();
      for (const e of r.events) {
        if (e.kind === 'touch' && e.pieceId && !seen.has(e.pieceId)) {
          seen.add(e.pieceId);
          const p = byId.get(e.pieceId);
          if (p && !p.setup) out.push({ ball: b, tick: e.tick, label: `${this.shortName(b)}: u/${p.username}'s ${pieceName(p.type)}` });
        }
        if (e.kind === 'gate' && e.n === 1) out.push({ ball: b, tick: e.tick, label: `${this.shortName(b)}: a gate opens` });
      }
      out.push({ ball: b, tick: Math.max(0, r.frames.length - 4), label: `${this.shortName(b)}: ${failureTitle(r)}` });
    });
    return out.slice(0, 12);
  }

  private showResults(): void {
    const v = this.app.view;
    const r = this.result;
    const byId = new Map(v.pieces.map((p) => [p.pieceId, p]));
    const award = (icon: string, name: string, a: { pieceId: string; username: string } | null, extra: string) => {
      const p = a ? byId.get(a.pieceId) : undefined;
      return h('div', { class: 'award' }, h('div', { class: 'aicon' }, icon), h('div', {}, h('div', { class: 'k' }, name), a && p ? h('div', {}, h('b', {}, `u/${a.username}`), ` · ${pieceName(p.type)}${extra}`) : h('div', { class: 'muted' }, 'Nobody this time')));
    };
    const mine = v.pieces.find((p) => p.userId === v.me.userId && !p.setup);
    const myLines: string[] = [];
    if (mine) {
      const touched = this.run.balls.map((b, i) => (b.touchedPieceIds.includes(mine.pieceId) ? i + 1 : 0)).filter(Boolean);
      myLines.push(touched.length ? `Your ${pieceName(mine.type)} helped steer ${touched.length === 1 ? '1 ball' : `${touched.length} balls`}.` : `No ball touched your ${pieceName(mine.type)}.`);
      if (r.awards.mvp?.pieceId === mine.pieceId) myLines.push('🏆 It was the MVP!');
    }
    if (v.me.prediction !== null) myLines.push(v.me.prediction === r.score ? `🔮 You guessed ${v.me.prediction}. Spot on!` : `🔮 You guessed ${v.me.prediction}. It was ${r.score}.`);
    const total = r.predictions.reduce((a, b) => a + b, 0);
    const hist = h(
      'div',
      { class: 'hist' },
      ...r.predictions.map((n, i) => h('div', { class: `hbar${i === r.score ? ' hit' : ''}` }, h('i', { style: `height:${total ? Math.max(4, Math.round((n / total) * 56)) : 4}px` }), h('span', {}, `${i}`), h('small', {}, total ? `${Math.round((n * 100) / total)}%` : '–'))),
    );
    const ballsRow = h(
      'div',
      { class: 'balls' },
      ...this.run.balls.map((b, i) => h('div', { class: `ball ${b.end === 'success' ? 'ok' : 'no'}` }, h('b', {}, b.end === 'success' ? '✓' : '✗'), h('span', {}, i === 0 ? 'Your ball' : variantInfo(b.variant).short), h('small', {}, failureTitle(b)))),
    );
    const moments = h('div', { class: 'chips wrap' }, ...this.moments().map((m) => h('button', { class: 'chip', onclick: () => void this.replay(m.ball, Math.max(0, m.tick - 3)) }, m.label)));
    const cur = v.current;
    const goNext =
      cur.postId && cur.postId !== v.day.postId
        ? h('button', { class: 'btn primary', style: 'width:100%;margin-top:6px', onclick: () => this.app.goToCurrent() }, `Build today's machine → Day ${cur.dayNumber}`)
        : h('div', { class: 'sub' }, 'The next machine is opening now.');
    showSheet(
      h(
        'div',
        { class: 'results' },
        h('h3', {}, `Day ${v.day.dayNumber}: ${r.score} of 3 balls made it`),
        r.streak > 1 ? h('div', { class: 'sub' }, `🔥 ${r.streak} days in a row with a ball in`) : null,
        ballsRow,
        goNext,
        r.awards.mvp ? award('🏆', 'Most useful piece', r.awards.mvp, '') : null,
        r.awards.mostTouched && r.awards.mostTouched.pieceId !== r.awards.mvp?.pieceId ? award('👆', 'Busiest piece', r.awards.mostTouched, ` · hit ${r.awards.mostTouched.value} times`) : null,
        r.awards.clutch ? award('⏱', 'Last-minute save', r.awards.clutch, ` · ${minutesBefore(r.lockedAt - r.awards.clutch.at)}`) : null,
        myLines.length ? h('div', { class: 'card' }, h('div', { class: 'k' }, 'You'), ...myLines.map((l) => h('div', {}, l))) : null,
        total > 0 ? h('div', { class: 'card' }, h('div', { class: 'k' }, 'Guesses'), hist) : null,
        h('div', { class: 'k', style: 'margin-top:8px' }, 'Watch a moment'),
        moments,
      ),
      { modal: false },
    );
  }
}
