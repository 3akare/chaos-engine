/**
 * The game screen. One frame: Solo/Team switch on top, the board, a three-key dock.
 *
 * Solo: your own machine for today (not the Team one) with every piece it has. Build, press ▶,
 *   the three balls roll, you get stars and see where each ball went. Stuck? Hints after 3 tries.
 * Team: the shared machine. Pieces are split between today's builders, nobody can make it worse,
 *   and at 02:00 UTC the three balls roll for real.
 *
 * There is no live path preview: you find out by rolling. Pieces are placed from a small bubble
 * next to the spot you tap, so nothing ever sits off screen.
 */
import { navigateTo } from '@devvit/web/client';
import { parseCell } from '../../shared/coords';
import type { DayView, PublicMachine, SoloPiece, StoredPiece } from '../../shared/protocol';
import { boardPieces, decide, holdersFrom, type BoardState, type Decision } from '../../shared/rules/placement';
import { levelOf } from '../../shared/sim/board';
import type { Level } from '../../shared/sim/level';
import { DAY_BALLS, runBalls, type DayRun } from '../../shared/sim/runDay';
import { PIECE_DIRS, PIECE_TYPES, W, type BoardPiece, type Dir, type PieceType } from '../../shared/types';
import { api } from '../lib/api';
import type { BoardScene, ScenePiece } from './scenes/BoardScene';
import { ballRow, confetti, rollThree, scoreTitle, starRow } from './show';
import { cardOpen, clearTag, closeCard, fmtCountdown, h, ico, pieceImg, showCard, spr, tag } from './ui/dom';
import { howToPlay, reportModal, welcome } from './ui/modals';
import { markWelcomed, welcomeSeen } from './ui/welcome';

const POLL_MS = 15_000;
export const PIECE_NAME: Record<PieceType, string> = { RAMP: 'Ramp', SPRING: 'Spring', FAN: 'Fan', BUMPER: 'Kicker' };
const BALL_COLOR = [0xe54341, 0x92a1ad, 0x2ecc71];
const HINT_AFTER = 3;

export type PlayMode = 'solo' | 'team';
/** A Team piece being placed or changed (sent to the server on ✓). `from`: which of your pieces moves here. */
type Edit = { socket: string; type: PieceType; dir: Dir; from: string | null };

const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string): void {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode */
    }
  },
};

export function initialMode(): PlayMode {
  const q = new URLSearchParams(location.search).get('mode');
  return (q ?? store.get('ce_mode')) === 'team' ? 'team' : 'solo';
}

const cellName = (x: number, y: number): string => `${'ABCDEFGHI'[x]}${y + 1}`;
const nextDir = (t: PieceType, d: Dir): Dir => {
  const dirs = PIECE_DIRS[t];
  return dirs[(dirs.indexOf(d) + 1) % dirs.length]!;
};

export class GameApp {
  view!: DayView;
  private teamLevel!: Level;
  private soloLevel!: Level;
  private mode: PlayMode = initialMode();
  private skew = 0;
  private edit: Edit | null = null;
  private busy = false;
  private rolling = false;
  private solo: Record<string, { type: PieceType; dir: Dir }> = {};
  private tries = 0;
  private hints: SoloPiece[] = [];
  private lastRun: Partial<Record<PlayMode, DayRun>> = {};
  private bubble: HTMLElement | null = null;
  private els: { tabs: HTMLElement; pill: HTMLElement; board: HTMLElement; dock: HTMLElement };

  constructor(
    root: HTMLElement,
    private scene: BoardScene,
    private postId: string | undefined,
  ) {
    const tab = (m: PlayMode, label: string): HTMLButtonElement => h('button', { class: 'tab', 'data-mode': m, onclick: () => this.switchMode(m) }, label);
    const tabs = h('div', { class: 'tabs', role: 'tablist' }, tab('solo', 'Solo'), tab('team', 'Team'));
    const pill = h('div', { class: 'pill' });
    const board = h('div', { id: 'board' });
    const dock = h('nav', { class: 'dock' });
    root.append(h('header', { class: 'top' }, tabs, pill), board, dock);
    this.els = { tabs, pill, board, dock };
  }

  async start(): Promise<void> {
    const r = await api.state(this.postId);
    if (!r.ok) {
      tag(r.error.message, 'bad', true);
      return;
    }
    this.setView(r.data);
    if (!welcomeSeen()) {
      markWelcomed();
      welcome(() => this.hello());
    } else this.hello();
    window.setInterval(() => this.tickPill(), 1000);
    window.setInterval(() => void this.poll(), POLL_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.poll();
    });
  }

  boardElement(): HTMLElement {
    return this.els.board;
  }

  private now(): number {
    return Date.now() + this.skew;
  }

  private get level(): Level {
    return this.mode === 'solo' ? this.soloLevel : this.teamLevel;
  }
  private get machine(): PublicMachine {
    return this.mode === 'solo' ? this.view.soloLevel : this.view.level;
  }

  private setView(v: DayView): void {
    const newDay = !this.view || this.view.day.dayId !== v.day.dayId;
    if (newDay) {
      this.teamLevel = levelOf({ ...v.level, solution: [] });
      this.soloLevel = levelOf({ ...v.soloLevel, solution: [] });
      this.loadSolo(v.day.dayId);
      this.lastRun = {};
    }
    this.view = v;
    this.skew = v.serverNow - Date.now();
    this.render();
  }

  private switchMode(m: PlayMode): void {
    if (this.rolling || m === this.mode) return;
    this.scene.stop();
    closeCard();
    this.mode = m;
    store.set('ce_mode', m);
    this.edit = null;
    this.render();
    this.hello();
  }

  private hello(): void {
    const v = this.view;
    if (this.mode === 'solo') {
      tag('Your own machine. Tap a + to build, then ▶', 'same');
      return;
    }
    if (v.day.status !== 'OPEN') return;
    const n = Math.max(v.counts.builders, 1);
    tag(`${n} ${n === 1 ? 'builder' : 'builders'} today · you can place ${v.me.allowance}`, 'same');
    if (v.me.inbox.length) reportModal(v.me.inbox, () => void api.ackInbox(this.postId));
  }

  private render(): void {
    for (const b of this.els.tabs.querySelectorAll<HTMLElement>('.tab')) b.classList.toggle('on', b.dataset.mode === this.mode);
    this.els.board.querySelector('.spinner')?.remove();
    this.closeBubble();
    this.tickPill();
    const target = this.machine.target ?? 'bell';
    this.scene.setBoard(this.level, this.scenePieces(), target);
    if (this.mode === 'solo') {
      this.scene.onTap = (x, y) => this.onTap(x, y);
      return this.toIdle();
    }
    const v = this.view;
    const open = v.day.status === 'OPEN' && v.serverNow < v.day.locksAt;
    if (open) {
      this.scene.onTap = (x, y) => this.onTap(x, y);
      this.toIdle();
    } else if (!v.result) {
      this.scene.onTap = null;
      this.scene.setTrails([]);
      this.els.board.append(spr('coin', 'spinner'));
      this.els.dock.replaceChildren();
      tag('The balls are rolling…', 'same', true);
    } else {
      this.scene.onTap = null;
      void this.nightResult();
    }
  }

  private tickPill(): void {
    if (!this.view) return;
    const pill = this.els.pill;
    const stars = (n: number | null): HTMLElement[] => [0, 1, 2].map((i) => spr('star', n !== null && i < n ? '' : 'miss'));
    if (this.mode === 'solo') return void pill.replaceChildren(h('span', {}, 'Best'), ...stars(this.view.solo.best));
    const v = this.view;
    const left = v.day.locksAt - this.now();
    if (v.day.status === 'OPEN' && left > 0) pill.replaceChildren(h('span', {}, `Rolls in ${fmtCountdown(left)}`));
    else if (v.result) pill.replaceChildren(h('span', {}, 'Team'), ...stars(v.result.score));
    else pill.replaceChildren(h('span', {}, 'Rolling'));
    if (v.day.status === 'OPEN' && left <= 0 && left > -1500 && !this.busy) void this.poll();
  }

  async poll(): Promise<void> {
    if (document.visibilityState !== 'visible' || this.scene.isPlaying() || this.rolling || this.edit || this.bubble || this.busy) return;
    const r = await api.state(this.postId);
    if (!r.ok) return;
    const sameDay = r.data.day.dayId === this.view.day.dayId;
    if (sameDay && (this.mode === 'solo' || (this.view.result && r.data.result) || cardOpen())) {
      this.view = r.data;
      this.tickPill();
    } else this.setView(r.data);
  }

  // ---------- pieces ----------

  private loadSolo(dayId: string): void {
    try {
      this.solo = JSON.parse(store.get(`ce_solo_${dayId}`) ?? '{}') as GameApp['solo'];
    } catch {
      this.solo = {};
    }
    this.tries = Number(store.get(`ce_tries_${dayId}`) ?? 0);
    this.hints = [];
  }
  private saveSolo(): void {
    store.set(`ce_solo_${this.view.day.dayId}`, JSON.stringify(this.solo));
  }

  private soloBoard(): BoardPiece[] {
    return Object.entries(this.solo).map(([socket, p]) => {
      const c = parseCell(socket)!;
      return { id: `solo-${socket}`, type: p.type, dir: p.dir, x: c[0], y: c[1] };
    });
  }

  private teamState(): BoardState {
    const pieces: Record<string, StoredPiece> = {};
    for (const p of this.view.pieces) pieces[p.socket] = p;
    return { pieces, inventory: { ...this.view.inventory }, holders: holdersFrom(pieces) };
  }

  private boardNow(): BoardPiece[] {
    return this.mode === 'solo' ? this.soloBoard() : boardPieces(this.teamState().pieces);
  }

  private scenePieces(): ScenePiece[] {
    const e = this.edit;
    let out: ScenePiece[];
    if (this.mode === 'solo') {
      out = this.soloBoard().map((p) => ({ ...p }));
      for (const hp of this.hints) {
        if (this.solo[hp.socket]) continue;
        const c = parseCell(hp.socket)!;
        out.push({ id: `hint-${hp.socket}`, type: hp.type, dir: hp.dir, x: c[0], y: c[1], ghost: true });
      }
    } else {
      const me = this.view.me.userId;
      out = [];
      for (const p of this.view.pieces) {
        if (e && (p.socket === e.socket || p.socket === e.from)) continue;
        const c = parseCell(p.socket)!;
        out.push({ id: p.pieceId, type: p.type, dir: p.dir, x: c[0], y: c[1], owner: p.username, setup: p.setup === true, mine: p.userId === me && !p.setup });
      }
      if (e) {
        const c = parseCell(e.socket)!;
        out.push({ id: 'edit', type: e.type, dir: e.dir, x: c[0], y: c[1], ghost: true, mine: true });
      }
    }
    return out;
  }

  /** Pieces still to place: Solo = what's left in the box; Team = your share. */
  private stock(t: PieceType): number {
    if (this.mode === 'team') return this.view.inventory[t];
    const used = Object.values(this.solo).filter((p) => p.type === t).length;
    return (this.view.soloLevel.inventory[t] ?? 0) - used;
  }
  private piecesLeft(): number {
    if (this.mode === 'solo') return PIECE_TYPES.reduce((a, t) => a + Math.max(0, this.stock(t)), 0);
    return Math.max(0, this.view.me.allowance - this.view.me.sockets.length);
  }

  /** Board changed: old trails no longer describe it. */
  private changed(): void {
    delete this.lastRun[this.mode];
    this.scene.setTrails([]);
  }

  // ---------- dock ----------

  private key(cls: string, label: string, onclick: () => void, ...kids: Array<Node | string | null>): HTMLButtonElement {
    return h('button', { class: `key ${cls}`, 'aria-label': label, onclick }, ...kids);
  }

  private toIdle(): void {
    this.edit = null;
    this.closeBubble();
    this.scene.setHighlights([]);
    this.scene.setPieces(this.scenePieces());
    this.scene.setGhost(undefined, undefined);
    const last = this.lastRun[this.mode];
    this.scene.setTrails(last ? last.balls.map((run, i) => ({ run, color: BALL_COLOR[i]! })) : []);
    const left = this.piecesLeft();
    this.els.dock.className = 'dock';
    this.els.dock.replaceChildren(
      this.key('', left === 1 ? '1 piece to place' : `${left} pieces to place`, () => this.hintSpots(), spr('spot'), h('span', { class: 'badge' }, String(left))),
      this.key('go', this.mode === 'solo' ? 'Roll the 3 balls' : 'Test: roll the 3 balls', () => void this.play(), ico('right')),
      this.key('blue', 'How to play', () => howToPlay(), ico('question')),
    );
  }

  private hintSpots(): void {
    const all: Array<[number, number]> = [];
    for (let i = 0; i < this.level.socket.length; i++) if (this.level.socket[i]) all.push([i % W, Math.floor(i / W)]);
    this.scene.setHighlights(all);
    const left = this.piecesLeft();
    tag(left > 0 ? `Tap a + to place ${left === 1 ? 'your piece' : `your ${left} pieces`}` : 'Tap one of your pieces to change it');
    window.setTimeout(() => {
      if (!this.bubble) this.scene.setHighlights([]);
    }, 1600);
  }

  // ---------- rolling ----------

  private async play(): Promise<void> {
    if (this.rolling) return;
    this.rolling = true;
    this.closeBubble();
    clearTag();
    const pieces = this.boardNow();
    const run = runBalls({ level: this.level, pieces }, DAY_BALLS);
    this.scene.setTrails([]);
    const mine = new Set(this.mode === 'solo' ? pieces.map((p) => p.id) : this.view.pieces.filter((p) => !p.setup).map((p) => p.pieceId));
    await rollThree(run, { scene: this.scene, board: this.els.board, dock: this.els.dock, playerPieceIds: mine, target: this.level.target, showOwners: this.mode === 'team' });
    this.rolling = false;
    this.lastRun[this.mode] = run;
    if (this.mode === 'solo') await this.soloResult(run);
    else this.testResult(run);
    this.toIdle();
  }

  private async soloResult(run: DayRun): Promise<void> {
    this.tries++;
    store.set(`ce_tries_${this.view.day.dayId}`, String(this.tries));
    const pieces: SoloPiece[] = Object.entries(this.solo).map(([socket, p]) => ({ socket, ...p }));
    const r = await api.solo({ postId: this.postId ?? this.view.day.postId ?? undefined, pieces });
    if (r.ok) this.view.solo = { best: r.data.best, players: r.data.players, perfect: r.data.perfect };
    this.tickPill();
    if (run.score === 3) confetti(this.els.board, 42);
    const canHint = run.score < 3 && this.tries >= HINT_AFTER && this.hints.length < (this.view.soloLevel.inventory ? Object.values(this.view.soloLevel.inventory).reduce((a, b) => a + b, 0) : 0);
    const note =
      run.score === 3
        ? this.view.solo.players > 1
          ? `${this.view.solo.perfect} of ${this.view.solo.players} players solved it`
          : 'Solved! Every ball made it.'
        : 'The coloured dots show where each ball went.';
    showCard(
      h(
        'div',
        {},
        h('h2', {}, scoreTitle(run.score)),
        starRow(run),
        ballRow(run),
        h('p', { class: 'note' }, note),
        canHint ? h('button', { class: 'key cta2 gold hud', onclick: () => void this.showHint() }, 'Show a hint') : null,
        run.score === 3 ? h('button', { class: 'key cta2 hud', onclick: () => this.switchMode('team') }, 'Now help the team') : null,
      ),
      run.score === 3 ? 'Done' : 'Keep building',
    );
  }

  private async showHint(): Promise<void> {
    closeCard();
    const r = await api.hint(this.postId ?? this.view.day.postId ?? undefined, this.hints.length + 1);
    if (!r.ok) return tag(r.error.message, 'bad');
    this.hints = r.data.pieces;
    const hp = this.hints[this.hints.length - 1]!;
    this.toIdle();
    const c = parseCell(hp.socket)!;
    this.scene.setHighlights([c]);
    tag(`Hint: a ${PIECE_NAME[hp.type].toLowerCase()} goes here, facing like this`, 'good', true);
  }

  private testResult(run: DayRun): void {
    showCard(
      h('div', {}, h('h2', {}, 'If it rolled now'), starRow(run), ballRow(run), h('p', { class: 'note' }, `It rolls for real in ${fmtCountdown(this.view.day.locksAt - this.now()) || 'a moment'}.`)),
      'Keep building',
    );
  }

  /** The night's real result: played once automatically, then the score card. */
  private async nightResult(): Promise<void> {
    const v = this.view;
    const run = runBalls({ level: this.teamLevel, pieces: boardPieces(this.teamState().pieces) }, DAY_BALLS);
    this.lastRun.team = run;
    const seenKey = `ce_seen_${v.day.dayId}`;
    const seen = store.get(seenKey) === '1';
    store.set(seenKey, '1');
    const watch = async (): Promise<void> => {
      if (this.rolling) return;
      this.rolling = true;
      closeCard();
      this.scene.setTrails([]);
      await rollThree(run, { scene: this.scene, board: this.els.board, dock: this.els.dock, playerPieceIds: new Set(v.pieces.filter((p) => !p.setup).map((p) => p.pieceId)), target: this.teamLevel.target, showOwners: true });
      this.rolling = false;
      this.nightCard(run, watch);
    };
    if (!seen) await watch();
    else this.nightCard(run, watch);
  }

  private nightCard(run: DayRun, watch: () => Promise<void>): void {
    if (this.mode !== 'team') return;
    const v = this.view;
    const r = v.result!;
    this.scene.setTrails(run.balls.map((b, i) => ({ run: b, color: BALL_COLOR[i]! })));
    this.els.dock.className = 'dock';
    this.els.dock.replaceChildren(this.key('go wide hud', 'Watch again', () => void watch(), 'Watch again'));
    if (r.score === 3) confetti(this.els.board, 42);
    const byId = new Map(v.pieces.map((p) => [p.pieceId, p]));
    const mvp = r.awards.mvp ? byId.get(r.awards.mvp.pieceId) : undefined;
    const cur = v.current;
    const next = !!cur.postId && cur.postId !== v.day.postId;
    showCard(
      h(
        'div',
        {},
        h('h2', {}, `Team: ${scoreTitle(r.score)}`),
        starRow(run),
        ballRow(run),
        mvp && r.awards.mvp ? h('div', { class: 'who' }, pieceImg(mvp.type, mvp.dir), h('span', { class: 'nm' }, h('b', {}, `u/${r.awards.mvp.username}`), h('span', { class: 'lbl' }, 'Most helpful piece'))) : null,
        h('p', { class: 'note' }, r.builders === 0 ? 'Nobody built on this one.' : `${r.builders} ${r.builders === 1 ? 'builder' : 'builders'} worked on this one.`),
      ),
      next ? `Play Day ${cur.dayNumber}` : 'OK',
      undefined,
      next ? () => this.goToCurrent() : undefined,
    );
  }

  // ---------- the bubble ----------

  private closeBubble(): void {
    this.bubble?.remove();
    this.bubble = null;
  }

  /** A small panel next to a board cell; kept fully inside the board. */
  private openBubble(x: number, y: number, ...kids: Array<Node | null>): void {
    this.closeBubble();
    const b = h('div', { class: 'bubble' }, h('div', { class: 'bubble-row' }, ...kids));
    b.addEventListener('pointerup', (e) => e.stopPropagation());
    this.els.board.append(b);
    this.bubble = b;
    const c = this.scene.cellCss(x, y);
    const bw = this.els.board.clientWidth;
    const w = b.offsetWidth;
    const hgt = b.offsetHeight;
    const left = Math.max(8, Math.min(bw - w - 8, c.x - w / 2));
    let top = c.y - c.size * 0.55 - hgt - 12;
    let below = false;
    if (top < 6) {
      top = c.y + c.size * 0.55 + 12;
      below = true;
    }
    b.style.left = `${left}px`;
    b.style.top = `${top}px`;
    b.classList.toggle('below', below);
    b.style.setProperty('--tip', `${Math.max(18, Math.min(w - 18, c.x - left))}px`);
    this.scene.setHighlights([[x, y]]);
  }

  private bkey(label: string, onclick: () => void, ...kids: Array<Node | string | null>): HTMLButtonElement {
    return h('button', { class: 'bkey', 'aria-label': label, onclick: (e: Event) => (e.stopPropagation(), onclick()) }, ...kids);
  }

  private pieceKey(t: PieceType, n: number, onclick: () => void): HTMLButtonElement {
    return this.bkey(`${PIECE_NAME[t]} (${n} left)`, onclick, h('span', { class: 'pic' }, pieceImg(t, PIECE_DIRS[t][0]!)), h('span', { class: 'name' }, PIECE_NAME[t]), h('span', { class: 'count' }, `×${n}`));
  }

  // ---------- tapping the board ----------

  private onTap(x: number, y: number): void {
    if (this.scene.isPlaying() || this.busy || this.rolling) return;
    if (!this.level.socket[y * W + x]) {
      if (this.bubble || this.edit) this.toIdle();
      return;
    }
    clearTag();
    const socket = cellName(x, y);
    if (this.mode === 'solo') return this.soloTap(x, y, socket);
    if (!this.view.me.userId) return tag('Log in to Reddit to build with the team', 'bad');
    const occupant = this.view.pieces.find((p) => p.socket === socket);
    if (occupant && (occupant.userId !== this.view.me.userId || occupant.setup)) return this.teamOther(x, y, occupant);
    this.teamTap(x, y, socket);
  }

  // Solo: changes are instant.
  private soloTap(x: number, y: number, socket: string): void {
    const own = this.solo[socket];
    if (own) return this.soloPieceMenu(x, y, socket);
    const types = PIECE_TYPES.filter((t) => this.stock(t) > 0);
    if (!types.length) {
      this.scene.setHighlights([[x, y]]);
      return tag('All your pieces are on the board. Tap one to move or turn it', 'same');
    }
    this.openBubble(
      x,
      y,
      ...types.map((t) =>
        this.pieceKey(t, this.stock(t), () => {
          this.solo[socket] = { type: t, dir: PIECE_DIRS[t][0]! };
          this.saveSolo();
          this.changed();
          this.scene.setPieces(this.scenePieces());
          this.soloPieceMenu(x, y, socket);
        }),
      ),
    );
  }

  private soloPieceMenu(x: number, y: number, socket: string): void {
    const p = this.solo[socket]!;
    const swaps = PIECE_TYPES.filter((t) => t !== p.type && this.stock(t) > 0);
    this.openBubble(
      x,
      y,
      this.bkey('Turn it', () => {
        p.dir = nextDir(p.type, p.dir);
        this.saveSolo();
        this.changed();
        this.scene.setPieces(this.scenePieces());
      }, ico('return'), h('span', { class: 'name' }, 'Turn')),
      ...swaps.map((t) =>
        this.pieceKey(t, this.stock(t), () => {
          this.solo[socket] = { type: t, dir: PIECE_DIRS[t][0]! };
          this.saveSolo();
          this.changed();
          this.scene.setPieces(this.scenePieces());
          this.soloPieceMenu(x, y, socket);
        }),
      ),
      this.bkey('Remove it', () => {
        delete this.solo[socket];
        this.saveSolo();
        this.changed();
        this.toIdle();
      }, ico('trashcan'), h('span', { class: 'name' }, 'Remove')),
    );
    this.els.board.querySelector('.bubble .bkey:first-child')?.classList.add('turn');
    this.refreshDockCount();
  }

  private refreshDockCount(): void {
    const badge = this.els.dock.querySelector('.badge');
    if (badge) badge.textContent = String(this.piecesLeft());
  }

  // Team: choose, then ✓ sends it to the server (the rules decide).
  private teamTap(x: number, y: number, socket: string): void {
    const mine = this.view.pieces.filter((p) => p.userId === this.view.me.userId && !p.setup);
    const ownHere = this.view.pieces.find((p) => p.socket === socket && p.userId === this.view.me.userId && !p.setup);
    if (ownHere) {
      this.edit = { socket, type: ownHere.type, dir: ownHere.dir, from: null };
      return this.teamEditMenu(x, y);
    }
    const from = mine.length >= this.view.me.allowance && mine.length > 0 ? mine[mine.length - 1]!.socket : null;
    const back = from ? this.view.pieces.find((p) => p.socket === from) : undefined;
    const types = PIECE_TYPES.filter((t) => this.view.inventory[t] + (back?.type === t ? 1 : 0) > 0);
    if (!types.length) return tag('No pieces left for the team today', 'same');
    if (from) tag('You’ve placed all yours: picking one moves your last piece here', 'same', true);
    this.openBubble(
      x,
      y,
      ...types.map((t) =>
        this.pieceKey(t, this.view.inventory[t] + (back?.type === t ? 1 : 0), () => {
          this.edit = { socket, type: t, dir: PIECE_DIRS[t][0]!, from };
          this.teamEditMenu(x, y);
        }),
      ),
    );
  }

  private teamOther(x: number, y: number, p: StoredPiece): void {
    tag(p.setup ? 'This piece came with the machine' : `u/${p.username} put this here`, 'same', true);
    this.openBubble(x, y, this.bkey('Replace it with a better one', () => this.teamTap(x, y, p.socket), ico('return'), h('span', { class: 'name' }, 'Replace')));
  }

  private teamDecision(): Decision | null {
    const e = this.edit;
    if (!e || !this.view.me.userId) return null;
    return decide(this.teamLevel, this.teamState(), { userId: this.view.me.userId, username: this.view.me.username ?? 'you' }, { kind: 'set', socket: e.socket, type: e.type, dir: e.dir, from: e.from ?? undefined }, this.now(), 'edit', {
      piecesNeeded: this.view.me.piecesNeeded,
    });
  }

  private teamEditMenu(x: number, y: number): void {
    const e = this.edit!;
    this.scene.setPieces(this.scenePieces());
    const d = this.teamDecision();
    const ok = !!d && d.ok;
    if (!d) tag('Log in to play', 'bad', true);
    else if (d.ok) tag(d.after[0] ? 'The normal ball reaches the flag!' : d.verdict.kind === 'better' ? 'Gets the normal ball further' : 'No change for the normal ball yet', d.verdict.kind === 'better' ? 'good' : 'same', true);
    else if (d.code === 'NO_CHANGE') tag('That’s how it already is: turn it', 'same', true);
    else if (d.code === 'MUST_IMPROVE') tag('Only a better piece can replace it', 'bad', true);
    else if (d.code === 'WOULD_HURT') tag('That makes it worse for the team', 'bad', true);
    else if (d.code === 'OUT_OF_STOCK') tag('None left', 'bad', true);
    else tag(d.message, 'bad', true);
    const own = this.view.pieces.find((p) => p.socket === e.socket && p.userId === this.view.me.userId && !p.setup);
    const place = this.bkey('Place it', () => void this.teamConfirm(), ico('checkmark'), h('span', { class: 'name' }, 'Place'));
    place.classList.add('ok');
    place.disabled = !ok || this.busy;
    this.openBubble(
      x,
      y,
      this.bkey('Turn it', () => {
        e.dir = nextDir(e.type, e.dir);
        this.teamEditMenu(x, y);
      }, ico('return'), h('span', { class: 'name' }, 'Turn')),
      place,
      own
        ? this.bkey('Remove your piece', () => void this.teamRemove(), ico('trashcan'), h('span', { class: 'name' }, 'Remove'))
        : this.bkey('Cancel', () => this.toIdle(), ico('cross'), h('span', { class: 'name' }, 'Cancel')),
    );
  }

  private async teamConfirm(): Promise<void> {
    const e = this.edit;
    if (!e || this.busy) return;
    this.busy = true;
    const r = await api.place({ postId: this.postId ?? this.view.day.postId ?? undefined, socketId: e.socket, type: e.type, dir: e.dir, from: e.from ?? undefined });
    this.busy = false;
    if (!r.ok) {
      tag(r.error.message, 'bad');
      const fresh = await api.state(this.postId);
      if (fresh.ok) this.view = fresh.data;
      return this.toIdle();
    }
    this.edit = null;
    this.changed();
    this.setView(r.data.state);
    tag('Placed!', 'good');
  }

  private async teamRemove(): Promise<void> {
    const e = this.edit;
    if (!e || this.busy) return;
    this.busy = true;
    const r = await api.remove(this.postId ?? this.view.day.postId ?? undefined, e.socket);
    this.busy = false;
    if (!r.ok) return tag(r.error.message, 'bad');
    this.edit = null;
    this.changed();
    this.setView(r.data.state);
  }

  goToCurrent(): void {
    closeCard();
    const url = this.view.current.url;
    if (url) navigateTo(url);
  }
}
