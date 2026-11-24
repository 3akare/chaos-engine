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

const PIECE_NAME: Record<PieceType, string> = { RAMP: 'Ramp', SPRING: 'Spring', FAN: 'Fan', BUMPER: 'Kicker' };
import { api } from '../lib/api';
import type { BoardScene, ScenePiece } from './scenes/BoardScene';
import { clearTag, closeCard, fmtCountdown, h, ico, pieceImg, spr, tag } from './ui/dom';
import { howToPlay, reportModal, welcome } from './ui/modals';
import { markWelcomed, welcomeSeen } from './ui/welcome';
import { RunScreen } from './run';

const POLL_MS = 15_000;

/** `from`: which of your pieces moves here (null = a new piece). */
type Candidate = { socket: string; type: PieceType; dir: Dir; from: string | null };
type Mode = 'idle' | 'pick' | 'other';

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
    const day = h('button', { class: 'day hud', 'aria-label': 'How to play', onclick: () => howToPlay() });
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
      if (!this.els.board.querySelector('.spinner')) this.els.board.append(spr('coin', 'spinner'));
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
    const t = open ? fmtCountdown(left) : '';
    this.els.time.textContent = t ? `Rolls in ${t}` : '';
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
    this.els.dock.className = 'dock';
    this.els.dock.replaceChildren(
      this.key('', `You can place ${left} ${left === 1 ? 'piece' : 'pieces'}`, () => this.hintSockets(), spr('spot'), h('span', { class: 'badge' }, String(left))),
      this.key('go', 'Roll the ball', () => void this.testRun(), ico('right')),
      this.key('blue', 'How to play', () => howToPlay(), ico('question')),
    );
    this.els.dock.children[1]?.setAttribute('data-act', 'test');
  }

  private hintSockets(): void {
    const all: Array<[number, number]> = [];
    for (let i = 0; i < this.level.socket.length; i++) if (this.level.socket[i]) all.push([i % W, Math.floor(i / W)]);
    this.scene.setHighlights(all);
    const left = Math.max(0, this.view.me.allowance - this.view.me.sockets.length);
    tag(left > 0 ? `Tap a + to add ${left === 1 ? 'your piece' : `your ${left} pieces`}` : 'Tap your piece to move it');
    window.setTimeout(() => {
      if (this.mode === 'idle') this.scene.setHighlights([]);
    }, 1600);
  }

  private async testRun(): Promise<void> {
    const btn = this.els.dock.querySelector('[data-act="test"]');
    if (this.scene.isPlaying()) {
      this.scene.stop();
      btn?.replaceChildren(ico('right'));
      this.scene.setGhost(this.currentRun(), undefined);
      return;
    }
    const r = this.currentRun();
    this.scene.setGhost(undefined, undefined);
    btn?.replaceChildren(ico('stop'));
    await this.scene.playRun(r, { speed: this.speed, showOwners: true });
    btn?.replaceChildren(ico('right'));
    if (this.mode === 'idle') {
      this.scene.setGhost(r, undefined);
      tag(r.end === 'success' ? 'It reached the flag!' : 'Tap a + to help it', r.end === 'success' ? 'good' : 'same');
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
    tag(p.setup ? 'This piece came with the machine' : `u/${p.username} put this here`);
    this.els.dock.className = 'dock';
    this.els.dock.replaceChildren(
      this.key('no', 'Back', () => this.toIdle(), ico('cross')),
      this.key('blue wide hud', 'Replace it with a better one', () => this.toPick(p.socket), 'Replace'),
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
    const firstInStock = PIECE_TYPES.find((t) => this.view.inventory[t] > 0) ?? 'RAMP';
    const type: PieceType = ownTarget?.type ?? keep?.type ?? base?.type ?? firstInStock;
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
    // Only the pieces today's machine has; each tile shows the piece, its name and how many are left.
    const tiles = PIECE_TYPES.filter((t) => stock(t) > 0 || t === c.type).map((t) => {
      const sel = t === c.type;
      const n = stock(t) - (sel ? 1 : 0);
      return h(
        'button',
        {
          class: `key tile${sel ? ' sel' : ''}`,
          'aria-label': sel ? `${PIECE_NAME[t]}: tap to turn it` : PIECE_NAME[t],
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
        h('span', { class: 'pic' }, pieceImg(t, sel ? c.dir : PIECE_DIRS[t][0]!), t === 'FAN' ? h('span', { class: `wind w-${sel ? c.dir : 'R'}` }, ico('arrowRight')) : null),
        h('span', { class: 'name' }, PIECE_NAME[t]),
        n > 0 ? h('span', { class: 'badge' }, `×${n}`) : null,
      );
    });
    const ok = !!d && d.ok;
    if (!d) tag('Log in to play', 'bad', true);
    else if (d.ok) tag(d.after[0] ? 'Reaches the flag!' : d.verdict.kind === 'better' ? 'Gets closer!' : own && !replacing && own.socket !== c.socket ? 'Moves your piece here' : 'Doesn’t help yet: try turning it', d.verdict.kind === 'better' ? 'good' : 'same', true);
    else if (d.code === 'NO_CHANGE') tag('Tap the piece again to turn it', 'same', true);
    else if (d.code === 'MUST_IMPROVE') tag('Only a better piece can replace it', 'bad', true);
    else if (d.code === 'WOULD_HURT') tag('That makes it worse', 'bad', true);
    else if (d.code === 'OUT_OF_STOCK') tag('None left', 'bad', true);
    else tag(d.message, 'bad', true);

    const left = own && own.socket === c.socket ? this.key('no', 'Remove your piece', () => void this.removeMine(), ico('cross')) : this.key('no', 'Cancel', () => this.toIdle(), ico('cross'));
    this.els.dock.className = 'dock tight';
    this.els.dock.replaceChildren(left, ...tiles, this.key('go', 'Place it', () => void this.confirm(), ico('checkmark')));
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

  goToCurrent(): void {
    closeCard();
    const url = this.view.current.url;
    if (url) navigateTo(url);
  }
}
