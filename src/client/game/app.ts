/**
 * Game controller. The frame never changes: top line · board · dock. Every interaction
 * swaps what the dock holds (play / place / guess / swap) instead of opening panels.
 */
import { navigateTo } from '@devvit/web/client';
import { parseCell } from '../../shared/coords';
import type { DayView, StoredPiece } from '../../shared/protocol';
import { ball1, decide, holdersFrom, type BoardState, type Decision } from '../../shared/rules/placement';
import { levelOf } from '../../shared/sim/board';
import type { Level } from '../../shared/sim/level';
import { PIECE_DIRS, PIECE_TYPES, W, type Dir, type PieceType, type SimResult } from '../../shared/types';
import { api } from '../lib/api';
import type { BoardScene, ScenePiece } from './scenes/BoardScene';
import { clearTag, closeCard, fmtCountdown, h, tag } from './ui/dom';
import { pieceIcon } from './ui/icons';
import { howToPlay, reportModal, welcome } from './ui/modals';
import { markWelcomed, welcomeSeen } from './ui/welcome';
import { RunScreen } from './run';

const POLL_MS = 15_000;

/** `from`: which of your pieces moves here (null = a new piece). */
type Candidate = { socket: string; type: PieceType; dir: Dir; from: string | null };
type Mode = 'idle' | 'pick' | 'guess' | 'other';

export class GameApp {
  view!: DayView;
  level!: Level;
  private skew = 0;
  private speed = 1.4;
  private mode: Mode = 'idle';
  private candidate: Candidate | null = null;
  private busy = false;
  private run: RunScreen | null = null;
  private els!: { day: HTMLElement; time: HTMLElement; board: HTMLElement; dock: HTMLElement; top: HTMLElement };

  constructor(
    root: HTMLElement,
    private scene: BoardScene,
    private postId: string | undefined,
  ) {
    const day = h('button', { class: 'day', 'aria-label': 'How to play', onclick: () => howToPlay() });
    const time = h('div', { class: 'time' });
    const top = h('header', { class: 'top' }, day, time);
    const board = h('div', { id: 'board' });
    const dock = h('nav', { class: 'dock' });
    root.append(top, board, dock);
    this.els = { day, time, board, dock, top };
  }

  async start(): Promise<void> {
    const r = await api.state(this.postId);
    if (!r.ok) {
      tag(r.error.message, 'bad', true);
      return;
    }
    this.setView(r.data);
    window.setInterval(() => this.tickClock(), 1000);
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

  private setView(v: DayView): void {
    const firstLoad = !this.view;
    if (!this.view || this.view.day.dayId !== v.day.dayId) this.level = levelOf({ ...v.level, solution: [] });
    this.view = v;
    this.skew = v.serverNow - Date.now();
    this.els.day.textContent = `Day ${v.day.dayNumber}`;
    this.tickClock();
    const open = v.day.status === 'OPEN' && v.serverNow < v.day.locksAt;
    if (open) {
      this.run?.destroy();
      this.run = null;
      this.els.board.querySelector('.spinner')?.remove();
      this.scene.setBoard(this.level, this.scenePieces(), v.level.target ?? 'bell');
      this.scene.onTap = (x, y) => this.onTap(x, y);
      this.toIdle();
      if (firstLoad) {
        if (!welcomeSeen()) {
          markWelcomed();
          welcome(() => this.showInbox());
        } else this.showInbox();
      }
    } else if (!v.result) {
      this.scene.onTap = null;
      this.scene.setBoard(this.level, this.scenePieces(), v.level.target ?? 'bell');
      this.scene.setGhost(undefined, undefined);
      if (!this.els.board.querySelector('.spinner')) this.els.board.append(h('div', { class: 'spinner' }));
      this.els.dock.replaceChildren();
    } else {
      this.scene.onTap = null;
      this.els.board.querySelector('.spinner')?.remove();
      if (!this.run) {
        this.run = new RunScreen(this, this.scene, this.els.dock, this.els.board);
        void this.run.start(firstLoad);
      }
    }
  }

  showInbox(): void {
    if (this.view.me.inbox.length) reportModal(this.view.me.inbox, () => void api.ackInbox(this.postId));
  }

  async poll(): Promise<void> {
    if (document.visibilityState !== 'visible' || this.scene.isPlaying() || this.mode !== 'idle' || this.busy) return;
    const r = await api.state(this.postId);
    if (r.ok) this.setView(r.data);
  }

  private tickClock(): void {
    if (!this.view) return;
    const open = this.view.day.status === 'OPEN';
    const left = this.view.day.locksAt - this.now();
    this.els.time.textContent = open ? fmtCountdown(left) : '';
    if (open && left <= 0 && left > -1500 && !this.busy) {
      this.toIdle();
      void this.poll();
    }
  }

  // ---------- board helpers ----------

  private boardState(): BoardState {
    const pieces: Record<string, StoredPiece> = {};
    for (const p of this.view.pieces) pieces[p.socket] = p;
    return { pieces, inventory: { ...this.view.inventory }, holders: holdersFrom(pieces) };
  }

  private mine(): StoredPiece[] {
    return this.view.pieces.filter((p) => p.userId === this.view.me.userId && !p.setup);
  }

  private moving(c: Candidate): StoredPiece | undefined {
    const target = this.view.pieces.find((p) => p.socket === c.socket);
    if (target && target.userId === this.view.me.userId && !target.setup) return target;
    if (c.from) return this.view.pieces.find((p) => p.socket === c.from);
    return undefined;
  }

  private scenePieces(extra?: Candidate): ScenePiece[] {
    const me = this.view.me.userId;
    const out: ScenePiece[] = [];
    for (const p of this.view.pieces) {
      const c = parseCell(p.socket)!;
      if (extra && (p.socket === extra.socket || p.socket === extra.from)) continue;
      out.push({ id: p.pieceId, type: p.type, dir: p.dir, x: c[0], y: c[1], owner: p.username, setup: p.setup === true, mine: p.userId === me && !p.setup });
    }
    if (extra) {
      const c = parseCell(extra.socket)!;
      out.push({ id: 'candidate', type: extra.type, dir: extra.dir, x: c[0], y: c[1], ghost: true, mine: true, owner: this.view.me.username ?? 'you' });
    }
    return out;
  }

  currentRun(): SimResult {
    return ball1(this.level, this.boardState().pieces);
  }

  // ---------- dock modes ----------

  private key(cls: string, label: string, onclick: () => void, ...kids: Array<Node | string>): HTMLButtonElement {
    return h('button', { class: `key ${cls}`, 'aria-label': label, onclick }, ...kids);
  }

  private toIdle(): void {
    this.mode = 'idle';
    this.candidate = null;
    clearTag();
    this.scene.setHighlights([]);
    this.scene.setPieces(this.scenePieces());
    this.scene.setGhost(this.currentRun(), undefined);
    const me = this.view.me;
    const left = Math.max(0, me.allowance - me.sockets.length);
    const pips = h('span', { class: 'pips' }, ...Array.from({ length: Math.min(4, me.allowance) }, (_, i) => h('i', { class: i < left ? 'on' : '' })));
    this.els.dock.className = 'dock';
    this.els.dock.replaceChildren(
      this.key('', `${left} pieces left`, () => this.hintSockets(), pips),
      this.key('primary', 'Run the ball', () => void this.testRun(), h('span', { class: 'tri' })),
      this.key('', 'Guess the score', () => this.toGuess(), me.prediction === null ? '?' : String(me.prediction)),
    );
    this.els.dock.children[1]?.setAttribute('data-act', 'test');
  }

  private hintSockets(): void {
    const all: Array<[number, number]> = [];
    for (let i = 0; i < this.level.socket.length; i++) if (this.level.socket[i]) all.push([i % W, Math.floor(i / W)]);
    this.scene.setHighlights(all);
    const left = Math.max(0, this.view.me.allowance - this.view.me.sockets.length);
    tag(left > 0 ? `${left} ${left === 1 ? 'piece' : 'pieces'} to place` : 'Tap your piece to move it');
    window.setTimeout(() => {
      if (this.mode === 'idle') this.scene.setHighlights([]);
    }, 1600);
  }

  private async testRun(): Promise<void> {
    const btn = this.els.dock.querySelector('[data-act="test"]');
    if (this.scene.isPlaying()) {
      this.scene.stop();
      btn?.classList.remove('playing');
      this.scene.setGhost(this.currentRun(), undefined);
      return;
    }
    const r = this.currentRun();
    this.scene.setGhost(undefined, undefined);
    btn?.classList.add('playing');
    await this.scene.playRun(r, { speed: this.speed, showOwners: true });
    btn?.classList.remove('playing');
    if (this.mode === 'idle') {
      this.scene.setGhost(r, undefined);
      tag(r.end === 'success' ? 'It made it!' : r.end === 'lost' ? 'Fell off the board' : r.end === 'loop' ? 'Bouncing forever' : 'Got stuck', r.end === 'success' ? 'good' : 'bad');
    }
  }

  private onTap(x: number, y: number): void {
    if (this.scene.isPlaying() || this.busy) return;
    if (!this.level.socket[y * W + x]) {
      if (this.mode !== 'idle') this.toIdle();
      return;
    }
    if (!this.view.me.userId) {
      tag('Log in to Reddit to play', 'bad');
      return;
    }
    const name = `${'ABCDEFGHI'[x]}${y + 1}`;
    const occupant = this.view.pieces.find((p) => p.socket === name);
    if (occupant && (occupant.userId !== this.view.me.userId || occupant.setup)) this.toOther(occupant);
    else this.toPick(name);
  }

  // Someone else's piece: who placed it, and a way to swap it.
  private toOther(p: StoredPiece): void {
    this.mode = 'other';
    this.scene.setHighlights([parseCell(p.socket)!]);
    tag(p.setup ? 'Starter piece' : `Placed by u/${p.username}`);
    this.els.dock.className = 'dock';
    this.els.dock.replaceChildren(
      this.key('flat', 'Back', () => this.toIdle(), '✕'),
      this.key('primary', 'Swap it for a better one', () => this.toPick(p.socket), '⇄'),
    );
  }

  // Placing: the dock becomes the piece tray.
  private toPick(socket: string): void {
    this.mode = 'pick';
    const mine = this.mine();
    const occupant = this.view.pieces.find((p) => p.socket === socket);
    const ownTarget = occupant && occupant.userId === this.view.me.userId && !occupant.setup ? occupant : undefined;
    const keep = this.candidate;
    let from: string | null = ownTarget ? null : (keep?.from ?? null);
    if (!ownTarget && from === null && mine.length >= this.view.me.allowance && mine.length > 0) from = mine[mine.length - 1]!.socket;
    const base = ownTarget ?? (from ? this.view.pieces.find((p) => p.socket === from) : undefined);
    const type: PieceType = ownTarget?.type ?? keep?.type ?? base?.type ?? 'RAMP';
    let dir: Dir = ownTarget?.dir ?? (keep?.type === type ? keep.dir : undefined) ?? base?.dir ?? PIECE_DIRS[type][0]!;
    if (!PIECE_DIRS[type].includes(dir)) dir = PIECE_DIRS[type][0]!;
    this.candidate = { socket, type, dir, from };
    this.scene.setHighlights([]);
    this.renderPick();
  }

  private decision(): Decision | null {
    const c = this.candidate;
    if (!c || !this.view.me.userId) return null;
    return decide(
      this.level,
      this.boardState(),
      { userId: this.view.me.userId, username: this.view.me.username ?? 'you' },
      { kind: 'set', socket: c.socket, type: c.type, dir: c.dir, from: c.from ?? undefined },
      this.now(),
      'candidate',
      { piecesNeeded: this.view.me.piecesNeeded },
    );
  }

  private previewState(): BoardState {
    const s = this.boardState();
    const c = this.candidate!;
    const own = this.moving(c);
    if (own) delete s.pieces[own.socket];
    s.pieces[c.socket] = { pieceId: 'candidate', socket: c.socket, type: c.type, dir: c.dir, userId: this.view.me.userId ?? '', username: '', placedAt: 0 };
    return s;
  }

  private renderPick(): void {
    const c = this.candidate!;
    const view = this.view;
    const own = this.moving(c);
    const occupant = view.pieces.find((p) => p.socket === c.socket);
    const replacing = occupant && occupant !== own;
    const d = this.decision();
    this.scene.setPieces(this.scenePieces(c));
    this.scene.setGhost(this.currentRun(), ball1(this.level, this.previewState().pieces));

    const stock = (t: PieceType): number => view.inventory[t] + (own?.type === t ? 1 : 0) + (replacing && occupant?.type === t ? 1 : 0);
    const tiles = PIECE_TYPES.map((t) => {
      const sel = t === c.type;
      return h(
        'button',
        {
          class: `key tile${sel ? ' sel' : ''}`,
          disabled: stock(t) <= 0,
          'aria-label': sel ? 'Turn it' : t.toLowerCase(),
          onclick: () => {
            if (sel) {
              const dirs = PIECE_DIRS[t];
              c.dir = dirs[(dirs.indexOf(c.dir) + 1) % dirs.length]!;
            } else {
              c.type = t;
              c.dir = PIECE_DIRS[t].includes(c.dir) ? c.dir : PIECE_DIRS[t][0]!;
            }
            this.renderPick();
          },
        },
        pieceIcon(t, sel ? c.dir : PIECE_DIRS[t][0]!, 36),
      );
    });
    const ok = !!d && d.ok;
    if (!d) tag('Log in to play', 'bad', true);
    else if (d.ok) tag(d.after[0] ? 'Reaches the goal!' : d.verdict.kind === 'better' ? 'Better' : own && !replacing && own.socket !== c.socket ? 'Moves your piece here' : 'No change yet', d.verdict.kind === 'better' ? 'good' : 'same', true);
    else if (d.code === 'NO_CHANGE') tag('Tap the piece again to turn it', 'same', true);
    else if (d.code === 'MUST_IMPROVE') tag('Not better than theirs', 'bad', true);
    else if (d.code === 'WOULD_HURT') tag('Makes it worse', 'bad', true);
    else if (d.code === 'OUT_OF_STOCK') tag('None of those left', 'bad', true);
    else tag(d.message, 'bad', true);

    const left = own && own.socket === c.socket ? this.key('flat', 'Remove your piece', () => void this.removeMine(), '✕') : this.key('flat', 'Cancel', () => this.toIdle(), '✕');
    this.els.dock.className = 'dock tight';
    this.els.dock.replaceChildren(left, ...tiles, this.key('good', 'Place it', () => void this.confirm(), '✓'));
    (this.els.dock.lastElementChild as HTMLButtonElement).disabled = !ok || this.busy;
  }

  private async confirm(): Promise<void> {
    const c = this.candidate;
    if (!c || this.busy) return;
    this.busy = true;
    const r = await api.place({ postId: this.postId ?? this.view.day.postId ?? undefined, socketId: c.socket, type: c.type, dir: c.dir, from: c.from ?? undefined });
    this.busy = false;
    if (!r.ok) {
      tag(r.error.message, 'bad');
      const fresh = await api.state(this.postId);
      if (fresh.ok) this.view = fresh.data;
      if (this.candidate) this.renderPick();
      return;
    }
    this.view = r.data.state;
    this.setView(r.data.state);
  }

  private async removeMine(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const r = await api.remove(this.postId ?? this.view.day.postId ?? undefined, this.candidate?.socket);
    this.busy = false;
    if (!r.ok) {
      tag(r.error.message, 'bad');
      return;
    }
    this.setView(r.data.state);
  }

  // Guessing: the dock becomes 0 1 2 3.
  private toGuess(): void {
    this.mode = 'guess';
    const v = this.view;
    tag('How many balls make it tonight?', 'same', true);
    const pick = async (n: number): Promise<void> => {
      const r = await api.predict({ postId: this.postId ?? v.day.postId ?? undefined, balls: n });
      if (!r.ok) {
        tag(r.error.message, 'bad');
        return;
      }
      this.setView(r.data.state);
      tag(`Your guess: ${n}`, 'good');
    };
    this.els.dock.className = 'dock tight';
    this.els.dock.replaceChildren(
      this.key('flat', 'Back', () => this.toIdle(), '✕'),
      ...[0, 1, 2, 3].map((n) => this.key(`digit${v.me.prediction === n ? ' sel' : ''}`, `${n} of 3`, () => void pick(n), String(n))),
    );
  }

  goToCurrent(): void {
    closeCard();
    const url = this.view.current.url;
    if (url) navigateTo(url);
  }
}
