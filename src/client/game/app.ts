/** Game controller: owns the Day view, the board scene and a deliberately tiny DOM overlay. */
import { navigateTo } from '@devvit/web/client';
import { parseCell } from '../../shared/coords';
import type { DayView, StoredPiece } from '../../shared/protocol';
import { ball1, decide, holdersFrom, type BoardState, type Decision } from '../../shared/rules/placement';
import { levelOf } from '../../shared/sim/board';
import type { Level } from '../../shared/sim/level';
import { PIECE_DIRS, PIECE_TYPES, W, type Dir, type PieceType, type SimResult } from '../../shared/types';
import { api } from '../lib/api';
import type { BoardScene, ScenePiece } from './scenes/BoardScene';
import { welcome, welcomeSeen } from './ui/welcome';
import { closeModal, closeSheet, fmtCountdown, h, sheetOpen, showSheet, toast } from './ui/dom';
import { pieceIcon } from './ui/icons';
import { howToPlay, pieceCard, reportModal } from './ui/modals';
import { RunScreen } from './run';

const POLL_MS = 15_000;

/** `from`: which of your pieces moves here (null = a new piece). */
type Candidate = { socket: string; type: PieceType; dir: Dir; from: string | null };

export class GameApp {
  view!: DayView;
  level!: Level;
  private skew = 0;
  private speed = 1.4;
  private candidate: Candidate | null = null;
  private busy = false;
  private run: RunScreen | null = null;
  private els!: { day: HTMLElement; time: HTMLElement; status: HTMLElement; bar: HTMLElement; board: HTMLElement; overlay: HTMLElement };

  constructor(
    private root: HTMLElement,
    private scene: BoardScene,
    private postId: string | undefined,
  ) {
    this.buildShell();
  }

  async start(): Promise<void> {
    const r = await api.state(this.postId);
    if (!r.ok) {
      this.els.overlay.replaceChildren(h('div', { class: 'note' }, r.error.message));
      return;
    }
    this.setView(r.data);
    window.setInterval(() => this.tickClock(), 1000);
    window.setInterval(() => void this.poll(), POLL_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.poll();
    });
  }

  // ---------- shell: day, timer, board, dock. Nothing else. ----------

  private buildShell(): void {
    const day = h('button', { class: 'day', 'aria-label': 'How to play', onclick: () => howToPlay() });
    const time = h('div', { class: 'time' });
    const status = h('div', { class: 'whisper', 'aria-live': 'polite' });
    const overlay = h('div', { class: 'overlay' });
    const board = h('div', { id: 'board' }, overlay, status);
    const bar = h('nav', { class: 'dock' });
    this.root.append(h('header', { class: 'top' }, day, time), board, bar);
    this.els = { day, time, status, bar, board, overlay };
    let hide = 0;
    new MutationObserver(() => {
      status.classList.toggle('show', status.textContent !== '');
      clearTimeout(hide);
      hide = window.setTimeout(() => status.classList.remove('show'), 2800);
    }).observe(status, { childList: true, characterData: true, subtree: true });
  }

  boardElement(): HTMLElement {
    return document.getElementById('board')!;
  }

  private now(): number {
    return Date.now() + this.skew;
  }

  private setView(v: DayView): void {
    const firstLoad = !this.view;
    const levelChanged = !this.view || this.view.day.dayId !== v.day.dayId;
    this.view = v;
    this.skew = v.serverNow - Date.now();
    if (levelChanged) this.level = levelOf({ ...v.level, solution: [] });
    this.els.day.textContent = `Day ${v.day.dayNumber}`;
    this.tickClock();
    const status = v.day.status;
    const pastLock = status === 'OPEN' && v.serverNow >= v.day.locksAt;
    if (status === 'OPEN' && !pastLock) {
      this.run?.destroy();
      this.run = null;
      this.els.overlay.replaceChildren();
      this.scene.setBoard(this.level, this.scenePieces(), v.level.target ?? 'bell');
      this.scene.setGhost(this.currentRun(), undefined);
      this.renderDock();
      this.scene.onTap = (x, y) => this.onTap(x, y);
      if (firstLoad) this.afterFirstLoad();
    } else if (!v.result) {
      this.closeAll();
      this.scene.onTap = null;
      this.scene.setBoard(this.level, this.scenePieces(), v.level.target ?? 'bell');
      this.scene.setGhost(undefined, undefined);
      this.els.overlay.replaceChildren(h('div', { class: 'spinner' }));
      this.els.bar.replaceChildren();
    } else {
      this.closeAll();
      this.scene.onTap = null;
      this.els.overlay.replaceChildren();
      if (!this.run) {
        this.run = new RunScreen(this, this.scene, this.els.bar, this.els.status, this.els.board);
        void this.run.start(firstLoad).then(() => {
          if (firstLoad) this.showInbox();
        });
      }
    }
  }

  private closeAll(): void {
    closeSheet(true);
    closeModal();
    this.candidate = null;
  }

  private afterFirstLoad(): void {
    if (!welcomeSeen()) welcome(this.view, () => this.showInbox());
    else this.showInbox();
  }

  showInbox(): void {
    const items = this.view.me.inbox;
    if (!items.length) return;
    reportModal(items, () => void api.ackInbox(this.postId));
  }

  async poll(): Promise<void> {
    if (document.visibilityState !== 'visible' || this.scene.isPlaying() || sheetOpen() || this.busy) return;
    const r = await api.state(this.postId);
    if (r.ok) this.setView(r.data);
  }

  private tickClock(): void {
    if (!this.view) return;
    const open = this.view.day.status === 'OPEN';
    const left = this.view.day.locksAt - this.now();
    this.els.time.textContent = open ? (left > 0 ? fmtCountdown(left) : '') : '';
    if (open && left <= 0 && left > -1500 && !this.busy) {
      closeSheet(true);
      void this.poll();
    }
  }

  // ---------- board state ----------

  private boardState(): BoardState {
    const pieces: Record<string, StoredPiece> = {};
    for (const p of this.view.pieces) pieces[p.socket] = p;
    return { pieces, inventory: { ...this.view.inventory }, holders: holdersFrom(pieces) };
  }

  private mine(): StoredPiece[] {
    return this.view.pieces.filter((p) => p.userId === this.view.me.userId && !p.setup);
  }

  /** The piece of yours this candidate moves or edits, if any. */
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

  // ---------- dock: pieces left · play · guess ----------

  private renderDock(): void {
    const me = this.view.me;
    const left = Math.max(0, me.allowance - me.sockets.length);
    const dots = h('span', { class: 'dots' }, ...Array.from({ length: me.allowance }, (_, i) => h('i', { class: i < left ? 'on' : '' })));
    this.els.bar.replaceChildren(
      h('button', { class: 'orb', 'data-act': 'place', 'aria-label': `${left} pieces left`, onclick: () => this.placeHint() }, dots),
      h('button', { class: 'orb play', 'data-act': 'test', 'aria-label': 'Run the ball', onclick: () => void this.testRun() }, h('span', { class: 'tri' })),
      h('button', { class: 'orb', 'data-act': 'predict', 'aria-label': 'Guess the score', onclick: () => this.predictSheet() }, h('span', { class: 'guess' }, me.prediction === null ? '?' : String(me.prediction))),
    );
  }

  private async testRun(): Promise<void> {
    if (this.scene.isPlaying()) {
      this.scene.stop();
      this.scene.setGhost(this.currentRun(), undefined);
      return;
    }
    const r = this.candidate ? (this.candidateRun() ?? this.currentRun()) : this.currentRun();
    this.scene.setGhost(undefined, undefined);
    const btn = this.els.bar.querySelector('[data-act="test"]') ?? document.querySelector('.sheet [data-act="try"]');
    btn?.classList.add('playing');
    await this.scene.playRun(r, { speed: this.speed, showOwners: true });
    btn?.classList.remove('playing');
    if (this.candidate) this.updatePreview();
    else this.scene.setGhost(r, undefined);
  }

  private placeHint(): void {
    const free: Array<[number, number]> = [];
    for (let i = 0; i < this.level.socket.length; i++) if (this.level.socket[i]) free.push([i % W, Math.floor(i / W)]);
    this.scene.setHighlights(free);
    window.setTimeout(() => this.scene.setHighlights([]), 1600);
  }

  private onTap(x: number, y: number): void {
    if (this.scene.isPlaying()) return;
    const i = y * W + x;
    if (!this.level.socket[i]) return;
    if (!this.view.me.userId) {
      toast('Log in to Reddit to play.');
      return;
    }
    const name = `${'ABCDEFGHI'[x]}${y + 1}`;
    const occupant = this.view.pieces.find((p) => p.socket === name);
    const mine = occupant && occupant.userId === this.view.me.userId && !occupant.setup;
    if (occupant && !mine && !this.candidate) {
      this.showPieceCard(occupant);
      return;
    }
    this.openPalette(name);
  }

  private showPieceCard(p: StoredPiece): void {
    this.scene.setHighlights([parseCell(p.socket)!]);
    showSheet(
      pieceCard(p, this.view, [{ label: 'Swap it', primary: true, run: () => this.openPalette(p.socket) }]),
      { onClose: () => this.scene.setHighlights([]) },
    );
  }

  // ---------- placing a piece ----------

  private openPalette(socket: string): void {
    const mine = this.mine();
    const occupant = this.view.pieces.find((p) => p.socket === socket);
    const ownTarget = occupant && occupant.userId === this.view.me.userId && !occupant.setup ? occupant : undefined;
    const keep = this.candidate;
    let from: string | null = keep?.from ?? null;
    if (ownTarget) from = null;
    else if (from === null && mine.length >= this.view.me.allowance && mine.length > 0) from = mine[mine.length - 1]!.socket;
    const base = ownTarget ?? (from ? this.view.pieces.find((p) => p.socket === from) : undefined);
    const type: PieceType = ownTarget?.type ?? keep?.type ?? base?.type ?? occupant?.type ?? 'RAMP';
    let dir: Dir = ownTarget?.dir ?? keep?.dir ?? base?.dir ?? occupant?.dir ?? PIECE_DIRS[type][0]!;
    if (!PIECE_DIRS[type].includes(dir)) dir = PIECE_DIRS[type][0]!;
    this.candidate = { socket, type, dir, from };
    this.scene.setHighlights([parseCell(socket)!]);
    this.renderPalette();
  }

  private candidateDecision(): Decision | null {
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

  private candidateRun(): SimResult | null {
    const d = this.candidateDecision();
    if (!d) return null;
    return ball1(this.level, d.ok ? d.next.pieces : this.previewState().pieces);
  }

  /** Board with the candidate applied regardless of validity (so the preview shows what would happen). */
  private previewState(): BoardState {
    const s = this.boardState();
    const c = this.candidate!;
    const own = this.moving(c);
    if (own) delete s.pieces[own.socket];
    s.pieces[c.socket] = { pieceId: 'candidate', socket: c.socket, type: c.type, dir: c.dir, userId: this.view.me.userId ?? '', username: '', placedAt: 0 };
    return s;
  }

  private updatePreview(): void {
    const c = this.candidate;
    if (!c) return;
    this.scene.setPieces(this.scenePieces(c));
    this.scene.setGhost(this.currentRun(), ball1(this.level, this.previewState().pieces));
  }

  private renderPalette(): void {
    const c = this.candidate!;
    const view = this.view;
    const own = this.moving(c);
    const occupant = view.pieces.find((p) => p.socket === c.socket);
    const replacing = occupant && occupant !== own;
    const d = this.candidateDecision();
    this.updatePreview();

    const available = (t: PieceType): number => view.inventory[t] + (own?.type === t ? 1 : 0) + (replacing && occupant?.type === t ? 1 : 0);
    const tiles = h(
      'div',
      { class: 'tiles' },
      ...PIECE_TYPES.map((t) => {
        const sel = t === c.type;
        const n = available(t);
        return h(
          'button',
          {
            class: `tile${sel ? ' sel' : ''}`,
            disabled: n <= 0,
            'aria-label': sel ? 'Turn it' : t.toLowerCase(),
            onclick: () => {
              if (sel) {
                const dirs = PIECE_DIRS[t];
                c.dir = dirs[(dirs.indexOf(c.dir) + 1) % dirs.length]!;
              } else {
                c.type = t;
                c.dir = PIECE_DIRS[t].includes(c.dir) ? c.dir : PIECE_DIRS[t][0]!;
              }
              this.renderPalette();
            },
          },
          pieceIcon(t, sel ? c.dir : PIECE_DIRS[t][0]!, 44),
          sel ? h('span', { class: 'turn', 'aria-hidden': 'true' }, '↻') : null,
          h('span', { class: 'count' }, ...Array.from({ length: Math.min(4, n) }, () => h('i', {}))),
        );
      }),
    );

    // One word of feedback, colour plus icon.
    const [state, word] = ((): ['good' | 'same' | 'bad', string] => {
      if (!d) return ['same', 'Log in to play'];
      if (d.ok) return [d.verdict.kind === 'better' ? 'good' : 'same', d.after[0] ? 'Reaches the goal!' : d.verdict.kind === 'better' ? 'Better' : 'No change'];
      if (d.code === 'NO_CHANGE') return ['same', 'Tap a piece to change it'];
      if (d.code === 'MUST_IMPROVE') return ['bad', 'Not better than theirs'];
      if (d.code === 'WOULD_HURT') return ['bad', 'Makes it worse'];
      if (d.code === 'OUT_OF_STOCK') return ['bad', 'None left'];
      return ['bad', d.message];
    })();
    const canConfirm = !!d && d.ok;

    const mine = this.mine();
    const atLimit = mine.length >= view.me.allowance;
    let moveRow: HTMLElement | null = null;
    if (atLimit && mine.length > 1 && !(occupant && occupant === own && !c.from)) {
      moveRow = h(
        'div',
        { class: 'moverow' },
        h('span', { class: 'mutedsm' }, 'Move'),
        ...mine
          .filter((p) => p.socket !== c.socket)
          .map((p) =>
            h(
              'button',
              {
                class: `mini${c.from === p.socket ? ' on' : ''}`,
                'aria-label': `Move your ${p.type.toLowerCase()}`,
                onclick: () => {
                  c.from = p.socket;
                  c.type = p.type;
                  c.dir = p.dir;
                  this.renderPalette();
                },
              },
              pieceIcon(p.type, p.dir, 28),
            ),
          ),
      );
    }

    const content = h(
      'div',
      { class: 'palette' },
      moveRow,
      tiles,
      h(
        'div',
        { class: 'actions' },
        own && own.socket === c.socket ? h('button', { class: 'orb sm', 'aria-label': 'Remove', onclick: () => void this.removeMine() }, '✕') : h('button', { class: 'orb sm', 'aria-label': 'Close', onclick: () => closeSheet() }, '✕'),
        h('div', { class: `word ${state}`, role: 'status' }, word),
        h('button', { class: 'orb sm', 'data-act': 'try', 'aria-label': 'Try it', onclick: () => void this.testRun() }, h('span', { class: 'tri sm' })),
        h('button', { class: `orb sm ok${canConfirm ? '' : ' off'}`, disabled: !canConfirm || this.busy, 'aria-label': 'Place it', onclick: () => void this.confirm() }, '✓'),
      ),
    );
    const existing = document.querySelector('.sheet.palette-sheet');
    if (sheetOpen() && existing) existing.replaceChildren(h('div', { class: 'grabber' }), content);
    else {
      const el = showSheet(content, { modal: false, onClose: () => this.cancelCandidate() });
      el.classList.add('palette-sheet');
      requestAnimationFrame(() => {
        const barH = this.els.bar.getBoundingClientRect().height;
        this.root.style.paddingBottom = `${Math.max(0, el.getBoundingClientRect().height - barH)}px`;
      });
    }
  }

  private cancelCandidate(): void {
    this.root.style.paddingBottom = '';
    this.candidate = null;
    this.scene.setHighlights([]);
    this.scene.setPieces(this.scenePieces());
    this.scene.setGhost(this.currentRun(), undefined);
  }

  private async confirm(): Promise<void> {
    const c = this.candidate;
    if (!c || this.busy) return;
    this.busy = true;
    const r = await api.place({ postId: this.postId ?? this.view.day.postId ?? undefined, socketId: c.socket, type: c.type, dir: c.dir, from: c.from ?? undefined });
    this.busy = false;
    if (!r.ok) {
      toast(r.error.message, 3000);
      const fresh = await api.state(this.postId);
      if (fresh.ok) this.view = fresh.data;
      if (this.candidate) this.renderPalette();
      return;
    }
    this.candidate = null;
    closeSheet(true);
    this.root.style.paddingBottom = '';
    this.scene.setHighlights([]);
    this.setView(r.data.state);
  }

  private async removeMine(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const r = await api.remove(this.postId ?? this.view.day.postId ?? undefined, this.candidate?.socket);
    this.busy = false;
    if (!r.ok) {
      toast(r.error.message, 3000);
      return;
    }
    this.candidate = null;
    closeSheet(true);
    this.root.style.paddingBottom = '';
    this.setView(r.data.state);
  }

  private predictSheet(): void {
    const v = this.view;
    const pick = async (n: number): Promise<void> => {
      const r = await api.predict({ postId: this.postId ?? v.day.postId ?? undefined, balls: n });
      if (!r.ok) {
        toast(r.error.message);
        return;
      }
      closeSheet(true);
      this.setView(r.data.state);
    };
    showSheet(
      h(
        'div',
        { class: 'guesssheet' },
        h('h3', {}, 'How many balls make it?'),
        h(
          'div',
          { class: 'guesses' },
          ...[0, 1, 2, 3].map((n) =>
            h(
              'button',
              { class: v.me.prediction === n ? 'sel' : '', onclick: () => void pick(n), 'aria-label': `${n} of 3` },
              h('b', {}, String(n)),
              h('span', { class: 'balls3' }, ...[0, 1, 2].map((k) => h('i', { class: k < n ? 'in' : '' }))),
            ),
          ),
        ),
      ),
    );
  }

  /** Navigate to the newest Day's post. */
  goToCurrent(): void {
    const url = this.view.current.url;
    if (url) navigateTo(url);
  }
}
