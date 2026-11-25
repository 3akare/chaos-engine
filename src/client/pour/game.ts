/**
 * The game screen. Two ways to play:
 * - Personal: levels in order, stars for 25 / 50 / 75 balls, a star opens the next level;
 * - Group: today's machine for the whole subreddit, your best on the leaderboard.
 * Physics runs here at a fixed 1/60 s step with the same code the server uses to check scores.
 */
import { fitPiece, snap } from '../../shared/pour/build';
import { LEVELS, STARS, starsFor, unlocked } from '../../shared/pour/levels';
import { Pour } from '../../shared/pour/sim';
import { BALLS, H, type Machine, type Piece, type Tool, TOOL_NAME, TOOLS, TURN, W } from '../../shared/pour/types';
import type { DayView, Entry, PourResult, Totals } from '../../shared/protocol';
import { api } from '../lib/api';
import * as sfx from './audio';
import { fmt, h, ico, spr, store, until } from './dom';
import { artReady, drawBumper, drawPlank, img, INK, View } from './draw';

const STEP = 1000 / 60;
type Mode = 'build' | 'pour' | 'done' | 'closed' | 'replay';
export type Play = 'personal' | 'group';

export type Nav = { navigateTo(url: string): void };

export class Game {
  private v!: DayView;
  private machine!: Machine;
  private pieces: Piece[] = [];
  private mode: Mode = 'build';
  private pour: Pour | null = null;
  private acc = 0;
  private last = 0;
  private count: number | null = null;
  private readonly flashes = new Map<unknown, number>();
  private pops: { x: number; y: number; t: number }[] = [];
  private drag: { piece: Piece; fresh: boolean; moved: boolean; sx: number; sy: number; onBoard: boolean; grab: { x: number; y: number } | null } | null = null;
  private selected: Piece | null = null;
  private clicks = 0;
  private replayOf: Piece[] | null = null;
  /** Server clock minus ours. */
  private skew = 0;
  /** Personal level being played, and the best on each level. */
  private level = 0;
  private personal: (number | null)[] = [];

  private readonly top = h('header', { class: 'top' });
  private readonly stage = h('div', { class: 'stage' });
  private readonly canvas = h('canvas', { 'aria-label': "Today's machine" });
  private readonly tip = h('div', { class: 'tip', hidden: true, role: 'status' });
  private readonly bar = h('nav', { class: 'bar' });
  private readonly view = new View(this.canvas);

  constructor(
    root: HTMLElement,
    private readonly postId: string | undefined,
    private readonly nav: Nav,
    private play: Play = 'group',
  ) {
    this.stage.append(this.canvas, this.tip);
    root.replaceChildren(this.top, this.stage, this.bar);
    new ResizeObserver(() => this.view.resize()).observe(this.canvas);
    this.canvas.addEventListener('pointerdown', (e) => this.boardDown(e));
  }

  async start(): Promise<void> {
    const [r] = await Promise.all([api.state(this.postId), artReady(), document.fonts?.load('20px "Lilita One"').catch(() => undefined)]);
    if (!r.ok) {
      this.stage.append(h('div', { class: 'veil' }, h('div', { class: 'card' }, h('h2', {}, 'Chaos Engine'), h('p', {}, r.error.message))));
      return;
    }
    this.v = r.data;
    this.skew = r.data.serverNow - Date.now();
    this.personal = mergeBest(r.data.me.personal, localPersonal());
    const saved = Number(store('ce_level') ?? NaN);
    this.level = Number.isInteger(saved) && saved >= 0 && saved < LEVELS.length && unlocked(this.personal, saved) ? saved : this.firstOpenLevel();
    this.view.resize();
    this.enter(this.play);
    if (!store('ce_seen_tip')) this.say('Drag pieces onto the board, then press Pour', 4500);
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ------------------------------------------------------------------ state helpers
  private closed(): boolean {
    return this.v.day.status !== 'OPEN' || this.v.serverNow >= this.v.day.locksAt;
  }
  private firstOpenLevel(): number {
    let i = 0;
    while (i + 1 < LEVELS.length && unlocked(this.personal, i + 1) && starsFor(this.personal[i] ?? 0) === 3) i++;
    return i;
  }
  private buildKey(): string {
    return this.play === 'group' ? `ce_build_${this.v.day.dayId}` : `ce_pbuild_${this.level}`;
  }
  private loadBuild(): Piece[] {
    try {
      const raw = store(this.buildKey());
      if (raw) return (JSON.parse(raw) as Piece[]).filter((p) => TOOLS.includes(p.type)).map((p) => fitPiece(this.machine, snap(p)));
    } catch {
      /* ignore */
    }
    return this.play === 'group' && this.v.me.build ? this.v.me.build.map((p) => ({ ...p })) : [];
  }

  /** Switch to Personal or Group (or to another level), dropping any pour in progress. */
  private enter(play: Play, level = this.level): void {
    this.closeCard();
    this.pour = null;
    this.count = null;
    this.replayOf = null;
    this.selected = null;
    this.play = play;
    this.level = level;
    store('ce_mode', play);
    if (play === 'personal') store('ce_level', String(level));
    this.machine = play === 'group' ? this.v.machine : LEVELS[level]!;
    if (play === 'group' && this.closed()) {
      this.mode = 'closed';
      this.pieces = this.v.me.build ?? [];
    } else {
      this.mode = 'build';
      this.pieces = this.loadBuild();
    }
    this.renderTop();
    this.renderBar();
    if (this.mode === 'closed') this.showClosed();
  }
  private saveBuild(): void {
    store(this.buildKey(), JSON.stringify(this.pieces));
  }
  private left(t: Tool): number {
    return (this.machine.tools[t] ?? 0) - this.pieces.filter((p) => p.type === t).length;
  }
  private say(text: string, ms = 2600): void {
    this.tip.textContent = text;
    this.tip.hidden = !text;
    clearTimeout(this.sayTimer);
    if (ms && text) this.sayTimer = setTimeout(() => (this.tip.hidden = true), ms);
  }
  private sayTimer: ReturnType<typeof setTimeout> | undefined;

  // ------------------------------------------------------------------ header and bar
  private renderTop(): void {
    const tab = (p: Play, label: string): HTMLElement =>
      h('button', { class: `tab${this.play === p ? ' on' : ''}`, role: 'tab', 'aria-selected': this.play === p ? 'true' : 'false', onclick: () => this.play !== p && this.enter(p) }, label);
    const tabs = h('div', { class: 'tabs', role: 'tablist' }, tab('personal', 'Personal'), tab('group', 'Group'));
    let right: HTMLElement;
    if (this.play === 'personal') {
      const best = this.personal[this.level] ?? null;
      right = h('button', { class: 'chip rank', 'aria-label': `Level ${this.level + 1}. Choose a level`, onclick: () => this.showLevels() }, h('span', { class: 'n' }, `Lv ${this.level + 1}`), starRow(best === null ? 0 : starsFor(best), 'mini'));
    } else {
      const me = this.v.me;
      const best = me.best === null ? '–' : String(me.best);
      right = h(
        'button',
        { class: 'chip rank', 'aria-label': `Leaderboard. Your best ${best}${me.rank ? `, rank ${me.rank}` : ''}`, onclick: () => this.showBoard() },
        ico('trophy', 'trophy'),
        h('span', { class: 'n' }, best),
        me.rank ? h('span', { class: 'r' }, `#${me.rank}`) : null,
      );
    }
    this.top.replaceChildren(tabs, h('div', { class: 'grow' }), right);
  }

  private renderBar(): void {
    const kids: HTMLElement[] = [];
    if (this.mode === 'build' || this.mode === 'done') {
      for (const t of TOOLS) {
        if (!this.machine.tools[t]) continue;
        const n = this.left(t);
        const el = h('div', { class: `tool${n ? '' : ' empty'}`, role: 'button', 'aria-label': `${TOOL_NAME[t]}: drag onto the board (${n} left)` }, toolIcon(t), h('b', {}, TOOL_NAME[t]), n ? h('i', {}, String(n)) : null);
        el.addEventListener('pointerdown', (e) => {
          if ((this.mode !== 'build' && this.mode !== 'done') || !this.left(t)) return;
          e.preventDefault();
          sfx.unlockAudio();
          this.toBuild();
          this.startDrag(e, { type: t, x: 0, y: 0, a: t === 'ramp' ? 20 : 0 }, true);
        });
        kids.push(el);
      }
      kids.push(h('button', { class: 'go', 'aria-label': 'Pour the balls', onclick: () => this.startPour() }, ico('right'), 'Pour'));
    } else if (this.mode === 'pour') {
      kids.push(h('button', { class: 'wide', onclick: () => this.skip() }, ico('fastForward'), 'Skip to the end'));
      kids.push(h('button', { class: 'go stop', 'aria-label': 'Stop', onclick: () => this.stopPour() }, ico('stop'), 'Stop'));
    } else if (this.mode === 'closed' || this.mode === 'replay') {
      const w = this.v.result?.winner;
      if (this.mode === 'replay') kids.push(h('button', { class: 'wide', onclick: () => this.skip() }, ico('fastForward'), 'Skip to the end'));
      else {
        if (w) kids.push(h('button', { class: 'wide yellow', onclick: () => this.replay(w.build) }, ico('trophy'), 'Watch the winner'));
        if (this.v.me.build) kids.push(h('button', { class: 'wide', onclick: () => this.replay(this.v.me.build!) }, ico('right'), 'Watch mine'));
      }
      const url = this.v.current.url;
      if (url && this.v.current.dayNumber !== this.v.day.dayNumber) kids.push(h('button', { class: 'go', 'aria-label': "Play today's machine", onclick: () => this.nav.navigateTo(url) }, ico('right'), 'Today'));
    }
    this.bar.replaceChildren(...kids);
  }

  private toBuild(): void {
    if (this.mode === 'done') {
      this.mode = 'build';
      this.pour = null;
      this.closeCard();
    }
  }

  // ------------------------------------------------------------------ dragging and turning
  private startDrag(e: PointerEvent, piece: Piece, fresh: boolean): void {
    const w = this.view.toWorld(e.clientX, e.clientY);
    this.drag = { piece, fresh, moved: false, sx: e.clientX, sy: e.clientY, onBoard: !fresh, grab: fresh ? null : { x: piece.x - w.x, y: piece.y - w.y } };
    if (fresh) this.moveDrag(e);
    const move = (ev: PointerEvent): void => this.moveDrag(ev);
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      this.endDrag();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  private moveDrag(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 8) d.moved = true;
    if (!d.fresh && !d.moved) return; // a tap turns the piece; it must not move
    const w = this.view.toWorld(e.clientX, e.clientY);
    // New pieces ride above a finger so you can see them; placed pieces keep where you grabbed them.
    const gx = d.grab ? d.grab.x : 0;
    const gy = d.grab ? d.grab.y : e.pointerType === 'touch' ? -36 : 0;
    d.piece.x = Math.max(12, Math.min(W - 12, w.x + gx));
    d.piece.y = Math.max(40, Math.min(H - 30, w.y + gy));
    d.onBoard = w.inside && w.y > 24 && w.y < H + 10;
  }

  private endDrag(): void {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (!d.fresh && !d.moved) {
      // A tap: turn it.
      const i = this.pieces.indexOf(d.piece);
      if (TURN[d.piece.type] && i >= 0) {
        this.pieces[i] = fitPiece(this.machine, snap({ ...d.piece, a: d.piece.a + TURN[d.piece.type] }));
        this.selected = this.pieces[i]!;
        sfx.tick();
        this.say('Turned. Tap again to keep turning', 1400);
      } else {
        this.selected = d.piece;
        this.say('Bumpers bounce balls away. Drag it off the board to take it back', 2200);
      }
      this.saveBuild();
      return;
    }
    if (!d.onBoard) {
      if (!d.fresh) {
        this.pieces = this.pieces.filter((p) => p !== d.piece);
        sfx.unplace();
      }
      this.selected = null;
      this.saveBuild();
      this.renderBar();
      return;
    }
    const placed = fitPiece(this.machine, snap(d.piece));
    if (d.fresh) this.pieces.push(placed);
    else this.pieces[this.pieces.indexOf(d.piece)] = placed;
    this.selected = placed;
    sfx.place();
    this.saveBuild();
    this.renderBar();
    if (d.fresh && !store('ce_seen_tip')) {
      store('ce_seen_tip', '1');
      this.say('Tap a piece to turn it. Drag it off the board to take it back', 3600);
    }
  }

  private boardDown(e: PointerEvent): void {
    sfx.unlockAudio();
    if (this.mode === 'done') this.toBuild();
    if (this.mode !== 'build') return;
    const w = this.view.toWorld(e.clientX, e.clientY);
    const hit = [...this.pieces].reverse().find((p) => Math.hypot(p.x - w.x, p.y - w.y) < 30);
    if (hit) {
      e.preventDefault();
      this.startDrag(e, hit, false);
      return;
    }
    this.selected = null;
  }

  // ------------------------------------------------------------------ pouring
  private startPour(): void {
    sfx.unlockAudio();
    this.closeCard();
    this.selected = null;
    this.say('');
    this.pour = new Pour(this.machine, this.pieces);
    this.count = 0;
    this.acc = 0;
    this.mode = 'pour';
    this.renderBar();
  }

  private stopPour(): void {
    this.pour = null;
    this.count = null;
    this.mode = this.replayOf ? 'closed' : 'build';
    if (this.replayOf) this.endReplay();
    this.renderBar();
  }

  /** Run the rest of the pour at once (same steps, same result). */
  private skip(): void {
    const p = this.pour;
    if (!p) return;
    while (!p.done) {
      p.step();
      p.events.length = 0;
    }
    this.count = p.caught;
  }

  private replay(build: Piece[]): void {
    sfx.unlockAudio();
    this.closeCard();
    this.replayOf = build;
    this.pieces = build.map((p) => ({ ...p }));
    this.pour = new Pour(this.machine, this.pieces);
    this.count = 0;
    this.acc = 0;
    this.mode = 'replay';
    this.renderBar();
  }

  private endReplay(): void {
    this.replayOf = null;
    this.mode = 'closed';
    this.renderBar();
  }

  private frame(now: number): void {
    const dt = Math.min(100, now - this.last);
    this.last = now;
    const p = this.pour;
    if (p && (this.mode === 'pour' || this.mode === 'replay')) {
      this.acc += dt;
      this.clicks = 0;
      let n = 0;
      while (this.acc >= STEP && !p.done && n < 6) {
        p.step();
        this.handleEvents(p, now);
        this.acc -= STEP;
        n++;
      }
      if (n >= 6) this.acc = 0;
      this.count = p.caught;
      if (p.done) {
        if (this.mode === 'pour') void this.finish(p.caught);
        else this.finishReplay(p.caught);
      }
    }
    this.view.render({ machine: this.machine, pieces: this.pieces, pour: this.mode === 'build' ? null : this.pour, drag: this.drag, selected: this.mode === 'build' ? this.selected : null, flashes: this.flashes, count: this.mode === 'build' ? null : this.count, pops: this.pops, now });
    this.pops = this.pops.filter((q) => now - q.t < 600);
    for (const [k, val] of this.flashes) {
      const nv = val - 0.08;
      if (nv <= 0) this.flashes.delete(k);
      else this.flashes.set(k, nv);
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  private handleEvents(p: Pour, now: number): void {
    for (const e of p.events) {
      if (e.k === 'catch') {
        sfx.ding(e.n);
        this.flashes.set('count', 1);
        this.flashes.set('bucket', 1);
        this.pops.push({ x: e.x, y: e.y - 10, t: now });
      } else if (e.k === 'spring') {
        sfx.boing();
        this.flashes.set(e.piece, 1);
      } else if (e.k === 'bumper') {
        sfx.bonk();
        this.flashes.set(e.piece, 1);
      } else if (e.k === 'hit' && this.clicks < 3 && e.speed > 1.2) {
        sfx.click(e.speed);
        this.clicks++;
      }
    }
    p.events.length = 0;
  }

  private finishReplay(n: number): void {
    const w = this.v.result?.winner;
    const whose = this.replayOf === w?.build ? `u/${w.username}` : 'Your best build';
    this.endReplay();
    this.card(h('h2', {}, whose), h('div', { class: 'big' }, String(n), h('small', {}, `/${BALLS}`)), h('div', { class: 'row' }, h('button', { class: 'btn b', onclick: () => this.closeCard() }, 'Close')));
  }

  private async finish(n: number): Promise<void> {
    this.mode = 'done';
    this.renderBar();
    sfx.fanfare(starsFor(n) + (n === BALLS ? 1 : 0));
    if (n === BALLS || (starsFor(n) === 3 && this.play === 'personal')) this.confetti();
    if (this.play === 'personal') return this.finishPersonal(n);
    const prev = this.v.me.best;
    const big = h('div', { class: 'big' }, String(n), h('small', {}, `/${BALLS}`));
    const line = h('p', {}, prev !== null && n <= prev ? `Your best today is ${prev}.` : 'Checking…');
    const title = h('h2', {}, n === BALLS ? 'All 100!' : prev === null || n > prev ? 'Nice pour!' : n >= prev - 3 ? 'So close!' : 'Keep tweaking');
    const stars = h('div', { class: 'starslot' }, starRow(starsFor(n), 'big'));
    this.card(title, stars, big, line, h('div', { class: 'row' }, h('button', { class: 'btn b', onclick: () => this.toBuild() }, 'Tweak'), h('button', { class: 'btn g', onclick: () => this.showBoard() }, 'Leaderboard')));
    const r = await api.pour({ postId: this.v.day.postId ?? this.postId, build: this.pieces, claimed: n });
    if (!r.ok) {
      line.textContent = r.error.message;
      return;
    }
    this.applyResult(r.data);
    const d = r.data;
    if (d.score !== n) {
      big.replaceChildren(String(d.score), h('small', {}, `/${BALLS}`));
      stars.replaceChildren(starRow(starsFor(d.score), 'big'));
    }
    if (d.improved) {
      title.textContent = d.score === BALLS ? 'All 100!' : prev === null ? 'On the board!' : 'New best!';
      line.textContent = d.rank ? `You're #${d.rank} today${prev !== null ? `, up from ${prev}` : ''}.` : 'Saved.';
    } else line.textContent = `Your best today is ${d.best}${d.rank ? `, #${d.rank} on the board` : ''}.`;
  }

  private async finishPersonal(n: number): Promise<void> {
    const i = this.level;
    const prev = this.personal[i] ?? null;
    const wasOpen = unlocked(this.personal, i + 1);
    if (prev === null || n > prev) this.personal[i] = n;
    saveLocalPersonal(this.personal);
    const s = starsFor(n);
    const opened = !wasOpen && i + 1 < LEVELS.length && unlocked(this.personal, i + 1);
    const nextOk = i + 1 < LEVELS.length && unlocked(this.personal, i + 1);
    const title = s === 3 ? 'Incredible!' : s === 2 ? 'Great pour!' : s === 1 ? 'Nice!' : n > 0 ? 'Keep tweaking' : 'All lost!';
    const line = opened
      ? `Level ${i + 2} unlocked!`
      : prev !== null && n <= prev
        ? `Your best here is ${prev}.${starsFor(prev) < 3 ? ` Next star at ${STARS[starsFor(prev)]}.` : ''}`
        : s < 3
          ? `${prev === null ? '' : `New best! `}Next star at ${STARS[s]}.`
          : prev === null ? 'Three stars first time!' : `New best! Up from ${prev}.`;
    this.card(
      h('h2', {}, title),
      h('div', { class: 'starslot' }, starRow(s, 'big')),
      h('div', { class: 'big' }, String(n), h('small', {}, `/${BALLS}`)),
      h('p', {}, line),
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn b', onclick: () => this.toBuild() }, 'Tweak'),
        nextOk ? h('button', { class: 'btn g', onclick: () => this.enter('personal', i + 1) }, 'Next level') : h('button', { class: 'btn g', onclick: () => this.enter('group') }, 'Play Group'),
      ),
    );
    this.renderTop();
    const r = await api.personal({ level: i, claimed: n });
    if (r.ok) {
      this.personal = mergeBest(r.data.personal, this.personal);
      saveLocalPersonal(this.personal);
    }
  }

  private showLevels(): void {
    const tiles = LEVELS.map((m, i) => {
      const open = unlocked(this.personal, i);
      const best = this.personal[i] ?? null;
      return h(
        'button',
        { class: `lv${open ? '' : ' locked'}${i === this.level ? ' on' : ''}`, 'aria-label': open ? `Level ${i + 1}, ${m.name}` : `Level ${i + 1}, locked`, onclick: () => open && this.enter('personal', i) },
        h('b', {}, String(i + 1)),
        open ? starRow(best === null ? 0 : starsFor(best), 'mini') : spr('lock', 'lock'),
      );
    });
    const total = this.personal.reduce<number>((a, b) => a + (b === null ? 0 : starsFor(b)), 0);
    this.card(
      h('h2', {}, 'Levels'),
      h('p', {}, `${total} of ${LEVELS.length * 3} stars. Get a star to open the next level.`),
      h('div', { class: 'levels' }, ...tiles),
      h('div', { class: 'row' }, h('button', { class: 'btn b', onclick: () => this.closeCard() }, 'Close')),
    );
  }

  private applyResult(d: PourResult): void {
    this.v.me.best = d.best;
    this.v.me.rank = d.rank;
    this.v.me.pours++;
    if (d.improved) this.v.me.build = this.pieces.map((p) => ({ ...p }));
    this.v.board = d.board;
    this.v.totals = d.totals;
    this.renderTop();
  }

  // ------------------------------------------------------------------ cards
  private veil: HTMLElement | null = null;
  private card(...kids: Array<Node | null>): void {
    this.closeCard();
    const veil = h('div', { class: 'veil', onclick: (e) => e.target === veil && this.closeCard() }, h('div', { class: 'card', role: 'dialog' }, ...kids.filter((k): k is Node => !!k)));
    this.stage.append(veil);
    this.veil = veil;
  }
  private closeCard(): void {
    this.veil?.remove();
    this.veil = null;
  }

  private showBoard(): void {
    const v = this.v;
    const rows = v.board.map((e) => boardRow(e, e.username === v.me.username));
    if (v.me.rank && v.me.best !== null && !v.board.some((e) => e.username === v.me.username)) rows.push(h('li', { class: 'gap' }, '⋯'), boardRow({ rank: v.me.rank, username: v.me.username ?? 'you', score: v.me.best, at: 0 }, true));
    const list = h('ol', { class: 'board' }, ...rows);
    requestAnimationFrame(() => list.querySelector('.me')?.scrollIntoView({ block: 'nearest' }));
    const closed = this.closed();
    const foot = closed ? (v.result?.winner ? `Build of the Day: u/${v.result.winner.username}` : 'This machine has closed.') : `Builds are revealed when the day closes in ${until(v.day.locksAt - Date.now() - this.skew)}.`;
    this.card(
      h('h2', {}, closed ? 'Final board' : "Today's board"),
      rows.length ? list : h('p', {}, 'Nobody has poured yet. Be the first!'),
      meter(v.result?.totals ?? v.totals),
      h('p', { class: 'foot' }, foot),
      h('div', { class: 'row' }, h('button', { class: 'btn b', onclick: () => this.closeCard() }, 'Close')),
    );
  }

  private showClosed(): void {
    const r = this.v.result;
    const w = r?.winner;
    this.card(
      h('h2', {}, `Day ${this.v.day.dayNumber} is over`),
      w ? h('div', { class: 'winner' }, ico('trophy'), h('span', {}, `u/${w.username}`), h('b', {}, String(w.score))) : h('p', {}, this.v.day.status === 'OPEN' || this.v.day.status === 'LOCKED' ? 'Counting the scores…' : 'Nobody poured on this one.'),
      this.v.me.best !== null ? h('p', {}, `You caught ${this.v.me.best}${this.v.me.rank ? ` and finished #${this.v.me.rank}` : ''}.`) : null,
      r ? meter(r.totals) : null,
      h('div', { class: 'row' }, w ? h('button', { class: 'btn y', onclick: () => this.replay(w.build) }, 'Watch it') : null, h('button', { class: 'btn b', onclick: () => this.closeCard() }, 'Close')),
    );
  }

  private confetti(): void {
    for (let i = 0; i < 40; i++) {
      const p = spr(i % 3 ? 'star' : 'coin', 'confetto');
      p.style.left = `${(i * 37) % 100}%`;
      p.style.animationDelay = `${(i % 10) * 60}ms`;
      this.stage.append(p);
      setTimeout(() => p.remove(), 2600);
    }
  }
}

function boardRow(e: Entry, me: boolean): HTMLElement {
  const medal = e.rank <= 3 ? h('span', { class: `medal m${e.rank}` }, String(e.rank)) : h('span', { class: 'medal' }, String(e.rank));
  return h('li', { class: me ? 'me' : '' }, medal, h('span', { class: 'who' }, `u/${e.username}`), h('b', {}, String(e.score)));
}

/** The subreddit's shared goal for the day. */
export function meter(t: Totals): HTMLElement {
  const pct = Math.min(100, Math.round((t.balls / Math.max(1, t.goal)) * 100));
  const bar = h('div', { class: 'fill' });
  bar.style.width = `${pct}%`;
  return h('div', { class: `meter${pct >= 100 ? ' full' : ''}` }, h('div', { class: 'lbl' }, h('span', {}, 'Together'), h('b', {}, `${fmt(t.balls)} / ${fmt(t.goal)} balls`)), h('div', { class: 'track' }, bar));
}

/** A tool's picture for the bar, drawn with the board's own routines. */
function toolIcon(t: Tool): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const s = Math.min(3, window.devicePixelRatio || 1);
  c.width = 40 * s;
  c.height = 34 * s;
  const g = c.getContext('2d')!;
  g.scale(s, s);
  g.translate(20, 17);
  if (t === 'ramp') {
    g.rotate(-0.35);
    drawPlank(g, 38, 10);
  }
  if (t === 'spring') g.drawImage(img('spring_out'), -16, -18, 32, 32);
  if (t === 'bumper') drawBumper(g, 0, 0, 0, 13);
  if (t === 'fan') {
    g.drawImage(img('fan'), -16, -16, 32, 32);
    g.drawImage(img('fan_blades'), -16, -17.5, 32, 32);
  }
  void INK;
  return c;
}

/** Three stars, the first `n` lit. */
function starRow(n: number, size: 'mini' | 'big'): HTMLElement {
  return h(
    'span',
    { class: `stars ${size}`, 'aria-label': `${n} of 3 stars` },
    ...[0, 1, 2].map((i) => {
      const s = spr('star', i < n ? '' : 'off');
      if (size === 'big') s.style.animationDelay = `${150 + i * 170}ms`;
      return s;
    }),
  );
}

function localPersonal(): (number | null)[] {
  try {
    return JSON.parse(store('ce_personal') ?? '[]') as (number | null)[];
  } catch {
    return [];
  }
}
function saveLocalPersonal(p: (number | null)[]): void {
  store('ce_personal', JSON.stringify(p));
}
/** Best of two progress lists, level by level. */
function mergeBest(a: readonly (number | null)[], b: readonly (number | null)[]): (number | null)[] {
  return LEVELS.map((_, i) => {
    const x = a[i] ?? null;
    const y = b[i] ?? null;
    return x === null ? y : y === null ? x : Math.max(x, y);
  });
}
