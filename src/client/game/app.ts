/** Game controller: owns the Day view, the board scene and the DOM overlay. */
import { navigateTo } from '@devvit/web/client';
import { cellName, circled, parseCell } from '../../shared/coords';
import type { DayView, StoredPiece } from '../../shared/protocol';
import { ball1, decide, holdersFrom, pieceName, type BoardState, type Decision } from '../../shared/rules/placement';
import { describeEnd } from '../../shared/rules/explain';
import { levelOf } from '../../shared/sim/board';
import type { Level } from '../../shared/sim/level';
import { PIECE_DIRS, PIECE_TYPES, W, type Dir, type PieceType, type SimResult } from '../../shared/types';
import { api } from '../lib/api';
import type { BoardScene, ScenePiece } from './scenes/BoardScene';
import { welcome, welcomeSeen } from './ui/welcome';
import { closeModal, closeSheet, fmtCountdown, h, sheetOpen, showSheet, toast } from './ui/dom';
import { PIECE_LABEL, pieceIcon } from './ui/icons';
import { howToPlay, pieceCard, reportModal } from './ui/modals';
import { RunScreen } from './run';

const POLL_MS = 15_000;
const KIND_NAMES: Record<string, string> = { solid: 'That’s a wall', start: 'That’s where the ball drops in', target: 'That’s the goal', checkpoint: 'That’s a checkpoint', switch: 'That’s a switch: the ball opens or closes gates when it rolls over it', gate: 'That’s a gate: a switch opens it', empty: 'Nothing goes there' };

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
  private els!: {
    title: HTMLElement;
    chips: HTMLElement;
    status: HTMLElement;
    bar: HTMLElement;
    board: HTMLElement;
    overlay: HTMLElement;
    countdown: HTMLElement;
  };

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
      this.els.overlay.replaceChildren(h('div', { class: 'big' }, r.error.message));
      return;
    }
    this.setView(r.data);
    window.setInterval(() => this.tickClock(), 1000);
    window.setInterval(() => void this.poll(), POLL_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.poll();
    });
  }

  // ---------- shell ----------

  private buildShell(): void {
    const title = h('div', { class: 'pill-title' });
    const help = h('button', { class: 'round small', 'aria-label': 'How to play', onclick: () => howToPlay() }, '?');
    const chips = h('div', { class: 'pill-meta' });
    const status = h('div', { class: 'bubble', 'aria-live': 'polite' });
    const overlay = h('div', { class: 'overlay' });
    const board = h('div', { id: 'board' }, overlay, status);
    const bar = h('div', { class: 'dock' });
    const countdown = h('span', {});
    this.root.append(h('header', { class: 'topbar' }, h('div', { class: 'pill' }, title, chips), help), board, bar);
    this.els = { title, chips, status, bar, board, overlay, countdown };
    // The status bubble shows whenever its text changes, then fades.
    let hide = 0;
    new MutationObserver(() => {
      status.classList.toggle('show', status.textContent !== '');
      clearTimeout(hide);
      hide = window.setTimeout(() => status.classList.remove('show'), 3200);
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
    this.renderHud();
    const status = v.day.status;
    const pastLock = status === 'OPEN' && v.serverNow >= v.day.locksAt;
    if (status === 'OPEN' && !pastLock) {
      this.run?.destroy();
      this.run = null;
      this.els.overlay.replaceChildren();
      this.scene.setBoard(this.level, this.scenePieces(), v.level.target ?? 'bell');
      this.renderBuildBar();
      this.refreshStatus();
      this.scene.onTap = (x, y) => this.onTap(x, y);
      if (firstLoad) this.afterFirstLoad();
    } else if (!v.result) {
      this.closeAll();
      this.scene.onTap = null;
      this.scene.setBoard(this.level, this.scenePieces(), v.level.target ?? 'bell');
      this.scene.setGhost(undefined, undefined);
      this.els.status.textContent = '';
      this.els.overlay.replaceChildren(h('div', { class: 'spinner' }), h('div', { class: 'big' }, 'Firing up the machine…'));
      this.els.bar.replaceChildren(h('button', { class: 'btn', disabled: true }, 'Results in a moment'));
    } else {
      this.closeAll();
      this.scene.onTap = null;
      this.els.overlay.replaceChildren();
      if (!this.run) {
        this.run = new RunScreen(this, this.scene, this.els.bar, this.els.status, this.els.board);
        // The personal report waits until the reveal and the three runs are over.
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

  // ---------- HUD ----------

  goalText(): string {
    const icon = this.view.level.target === 'basket' ? '🧺' : '🔔';
    const verb = this.view.level.target === 'basket' ? 'Get the ball in the basket' : 'Get the ball to the bell';
    if (this.view.level.objective.type === 'CHECKPOINTS_THEN_DELIVER') {
      const n = this.view.level.objective.count;
      return `${icon} ${verb}, through ${Array.from({ length: n }, (_, i) => circled(i + 1)).join('')} first`;
    }
    return `${icon} ${verb}`;
  }

  private renderHud(): void {
    const v = this.view;
    const icon = v.level.target === 'basket' ? '🧺' : '🔔';
    this.els.title.replaceChildren(`${icon} Day ${v.day.dayNumber}`);
    const tier = v.level.gen?.tier ?? 1;
    const dots = h('span', { class: 'tier', 'aria-label': `Difficulty ${tier} of 3` }, ...[1, 2, 3].map((k) => h('i', { class: k <= tier ? 'on' : '' })));
    this.els.chips.replaceChildren(dots, v.day.status === 'OPEN' ? this.els.countdown : '');
    this.tickClock();
  }

  private tickClock(): void {
    if (!this.view) return;
    const left = this.view.day.locksAt - this.now();
    this.els.countdown.textContent = left > 0 ? `${fmtCountdown(left)}` : 'firing';
    if (this.view.day.status === 'OPEN' && left <= 0 && left > -1500 && !this.busy) {
      // Lock time passed: refresh into "Firing up the machine…" until the cron resolves it.
      closeSheet(true);
      void this.poll();
    }
  }

  // ---------- build mode ----------

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

  private refreshStatus(): void {
    const r = this.currentRun();
    this.els.status.textContent = r.end === 'success' ? 'Right now: the ball reaches the goal ✓' : `Right now: the ball ${describeEnd(r)}`;
    if (!this.candidate) this.scene.setGhost(r, undefined);
  }

  private renderBuildBar(): void {
    const me = this.view.me;
    const pred = me.prediction;
    const left = Math.max(0, me.allowance - me.sockets.length);
    this.els.bar.replaceChildren(
      h('button', { class: 'round side', 'data-act': 'place', 'aria-label': `Pieces: ${left} left`, onclick: () => this.placeHint() }, h('span', { class: 'glyph' }, '◆'), h('span', { class: 'lbl' }, `${left} left`)),
      h('button', { class: 'round play', 'data-act': 'test', 'aria-label': 'Test run', onclick: () => void this.testRun() }, h('span', { class: 'playglyph' }, '▶')),
      h('button', { class: 'round side', 'data-act': 'predict', 'aria-label': 'Guess the score', onclick: () => this.predictSheet() }, h('span', { class: 'glyph' }, pred === null ? '?' : String(pred)), h('span', { class: 'lbl' }, 'guess')),
    );
  }


  private async testRun(): Promise<void> {
    if (this.scene.isPlaying()) {
      this.scene.stop();
      this.refreshStatus();
      return;
    }
    const r = this.candidate ? this.candidateRun() ?? this.currentRun() : this.currentRun();
    this.scene.setGhost(undefined, undefined);
    const btn = this.els.bar.querySelector('[data-act="test"]');
    btn?.classList.add('playing');
    await this.scene.playRun(r, { speed: this.speed, showOwners: true });
    btn?.classList.remove('playing');
    this.els.status.textContent = r.end === 'success' ? 'The ball reaches the goal ✓' : `The ball ${describeEnd(r)}`;
    if (this.candidate) this.updatePreview();
    else this.scene.setGhost(r, undefined);
  }

  private placeHint(): void {
    const free: Array<[number, number]> = [];
    for (let i = 0; i < this.level.socket.length; i++) if (this.level.socket[i]) free.push([i % W, Math.floor(i / W)]);
    this.scene.setHighlights(free);
    const me = this.view.me;
    const left = me.allowance - me.sockets.length;
    toast(
      left > 0
        ? `Tap a dashed socket to add a piece. You can hold ${me.allowance} right now (${left} left).`
        : `You're holding all ${me.allowance} you can. Tap a socket to move one there, or tap one of yours to turn or remove it.`,
      3600,
    );
    window.setTimeout(() => this.scene.setHighlights([]), 2400);
  }

  private onTap(x: number, y: number): void {
    if (this.scene.isPlaying()) return;
    const name = cellName(x, y);
    const i = y * W + x;
    if (!this.level.socket[i]) {
      const k = this.level.kinds[i] ?? 'empty';
      this.els.status.textContent = `${KIND_NAMES[k] ?? 'That’s part of the machine'}. Pieces go in the dashed squares.`;
      void name;
      return;
    }
    if (!this.view.me.userId) {
      toast('Log in to Reddit to add a piece.');
      return;
    }
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
      pieceCard(p, this.view, [
        { label: 'Try a better piece', primary: true, run: () => this.openPalette(p.socket) },
        { label: 'Close', run: () => closeSheet() },
      ]),
      { onClose: () => this.scene.setHighlights([]) },
    );
  }

  private openPalette(socket: string): void {
    const mine = this.mine();
    const occupant = this.view.pieces.find((p) => p.socket === socket);
    const ownTarget = occupant && occupant.userId === this.view.me.userId && !occupant.setup ? occupant : undefined;
    const keep = this.candidate;
    // New piece while under your limit; at the limit with a single piece, that piece moves.
    let from: string | null = keep?.from ?? null;
    if (ownTarget) from = null;
    else if (from === null && mine.length >= this.view.me.allowance && mine.length === 1) from = mine[0]!.socket;
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
    const next = d.ok ? d.next : this.previewState();
    return ball1(this.level, next.pieces);
  }

  /** Board with the candidate applied regardless of validity (so the ghost path shows what would happen). */
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
    const before = this.currentRun();
    const after = ball1(this.level, this.previewState().pieces);
    this.scene.setGhost(before, after);
  }

  private renderPalette(): void {
    const c = this.candidate!;
    const view = this.view;
    const own = this.moving(c);
    const occupant = view.pieces.find((p) => p.socket === c.socket);
    const replacing = occupant && occupant !== own;
    const mine = this.mine();
    const atLimit = mine.length >= view.me.allowance;
    const d = this.candidateDecision();
    this.updatePreview();

    const available = (t: PieceType): number => view.inventory[t] + (own?.type === t ? 1 : 0) + (replacing && occupant?.type === t ? 1 : 0);
    const palette = h(
      'div',
      { class: 'palette' },
      ...PIECE_TYPES.map((t) => {
        const sel = t === c.type;
        const n = available(t);
        const dir = sel ? c.dir : PIECE_DIRS[t][0]!;
        return h(
          'button',
          {
            class: `pbtn${sel ? ' sel' : ''}`,
            disabled: n <= 0,
            'aria-label': `${PIECE_LABEL[t]}${sel ? ', tap to rotate' : ''}`,
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
          h('span', { class: 'stock' }, `×${n}`),
          pieceIcon(t, dir, 34),
          sel ? `${PIECE_LABEL[t]} ↻` : PIECE_LABEL[t],
        );
      }),
    );

    let heading: string;
    let sub: string;
    if (replacing) {
      heading = `Swap ${occupant!.setup ? 'this' : `u/${occupant!.username}'s`} ${pieceName(occupant!.type)}`;
      sub = 'Yours has to work better than theirs.';
    } else if (own && own.socket === c.socket) {
      heading = `Your ${pieceName(own.type)}`;
      sub = 'Tap a piece to change it, or tap it again to turn it.';
    } else if (own) {
      heading = `Move your ${pieceName(own.type)} here`;
      sub = 'It can’t make the ball do worse.';
    } else {
      heading = 'Add a piece here';
      sub = 'Pick a piece. Tap it again to turn it.';
    }

    let verdictEl: HTMLElement;
    let canConfirm = false;
    if (!d) verdictEl = h('div', { class: 'verdict' }, 'Log in to Reddit to build.');
    else if (d.ok) {
      canConfirm = true;
      const icon = d.verdict.kind === 'better' ? '✅' : '☑️';
      verdictEl = h('div', { class: `verdict ${d.verdict.kind}`, role: 'status' }, h('span', { class: 'vi' }, icon), h('div', {}, h('b', {}, d.verdict.label), ' ', d.verdict.reason));
    } else if (d.code === 'LIMIT') {
      verdictEl = h('div', { class: 'verdict' }, h('span', { class: 'vi' }, '👆'), h('div', {}, `You've used all ${view.me.allowance} of your pieces. Pick one above to move it here.`));
    } else if (d.code === 'NO_CHANGE') {
      verdictEl = h('div', { class: 'verdict' }, h('span', { class: 'vi' }, '👆'), h('div', {}, 'That’s your piece. Tap a piece above to change it.'));
    } else {
      verdictEl = h('div', { class: 'verdict lower', role: 'status' }, h('span', { class: 'vi' }, '⛔'), h('div', {}, d.message));
    }

    const buttons = h(
      'div',
      { class: 'row' },
      h('button', { class: 'round small', 'aria-label': 'Try it', onclick: () => void this.testRun() }, '▶'),
      own && own.socket === c.socket ? h('button', { class: 'btn ghost', onclick: () => void this.removeMine() }, 'Remove') : null,
      h('button', { class: 'btn go', disabled: !canConfirm || this.busy, onclick: () => void this.confirm() }, this.busy ? '…' : replacing ? 'Swap' : own ? 'Move here' : 'Place'),
    );
    // Holding several pieces: choose a new piece or which of yours moves here.
    let chooser: HTMLElement | null = null;
    if (mine.length > 0 && !(occupant && occupant === own && !c.from)) {
      const opts: Array<{ label: string; from: string | null; disabled: boolean }> = [];
      opts.push({ label: atLimit ? `New piece (limit ${view.me.allowance})` : 'New piece', from: null, disabled: atLimit });
      for (const p of mine) if (p.socket !== c.socket) opts.push({ label: `Move your ${pieceName(p.type)}${mine.filter((q) => q.type === p.type).length > 1 ? ` #${mine.filter((q) => q.type === p.type).indexOf(p) + 1}` : ''}`, from: p.socket, disabled: false });
      chooser = h(
        'div',
        { class: 'chips wrap', style: 'margin:2px 0 6px' },
        ...opts.map((o) =>
          h(
            'button',
            {
              class: `chip${c.from === o.from ? ' on' : ''}`,
              disabled: o.disabled,
              onclick: () => {
                c.from = o.from;
                const src = o.from ? view.pieces.find((p) => p.socket === o.from) : undefined;
                if (src) {
                  c.type = src.type;
                  c.dir = src.dir;
                }
                this.renderPalette();
              },
            },
            o.label,
          ),
        ),
      );
    }
    void sub;
    const content = h('div', { class: 'palette-wrap' }, h('h3', {}, heading), chooser, palette, verdictEl, buttons);
    if (sheetOpen() && document.querySelector('.sheet.palette-sheet')) {
      document.querySelector('.sheet.palette-sheet')!.replaceChildren(h('div', { class: 'grabber' }), content);
    } else {
      const el = showSheet(content, { modal: false, onClose: () => this.cancelCandidate() });
      el.classList.add('palette-sheet');
      // Shrink the board so the whole machine (and the ghost path) stays visible above the sheet.
      requestAnimationFrame(() => {
        const barH = this.els.bar.getBoundingClientRect().height;
        this.root.style.paddingBottom = `${Math.max(0, el.getBoundingClientRect().height - barH)}px`;
      });
      // Tapping the board outside the sheet retargets; a close button sits in the grabber area.
      el.prepend(h('button', { class: 'round small close-x', 'aria-label': 'Close', onclick: () => closeSheet() }, '✕'));
    }
  }

  private cancelCandidate(): void {
    this.root.style.paddingBottom = '';
    this.candidate = null;
    this.scene.setHighlights([]);
    this.scene.setPieces(this.scenePieces());
    this.refreshStatus();
  }

  private async confirm(): Promise<void> {
    const c = this.candidate;
    if (!c || this.busy) return;
    this.busy = true;
    this.renderPalette();
    const r = await api.place({ postId: this.postId ?? this.view.day.postId ?? undefined, socketId: c.socket, type: c.type, dir: c.dir, from: c.from ?? undefined });
    this.busy = false;
    if (!r.ok) {
      toast(r.error.message, 4000);
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
    toast(r.data.verdict, 3200);
  }

  private async removeMine(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const r = await api.remove(this.postId ?? this.view.day.postId ?? undefined, this.candidate?.socket);
    this.busy = false;
    if (!r.ok) {
      toast(r.error.message, 4000);
      return;
    }
    this.candidate = null;
    closeSheet(true);
    this.root.style.paddingBottom = '';
    this.setView(r.data.state);
    toast('That piece is back in stock. Place it anywhere.');
  }

  private predictSheet(): void {
    const v = this.view;
    const goal = v.level.target === 'basket' ? 'the basket' : 'the bell';
    const pick = async (n: number): Promise<void> => {
      const r = await api.predict({ postId: this.postId ?? v.day.postId ?? undefined, balls: n });
      if (!r.ok) {
        toast(r.error.message);
        return;
      }
      closeSheet(true);
      this.setView(r.data.state);
      toast(`Prediction saved: ${n}/3. You can change it until lock.`);
    };
    showSheet(
      h(
        'div',
        {},
        h('h3', {}, `How many balls will reach ${goal}?`),
        h('div', { class: 'sub' }, 'Ball 1 is the one you can test. Balls 2 and 3 are secret variants, revealed at lock. Change your guess any time before then.'),
        h('div', { class: 'predict' }, ...[0, 1, 2, 3].map((n) => h('button', { class: v.me.prediction === n ? 'sel' : '', onclick: () => void pick(n), 'aria-label': `${n} of 3` }, String(n)))),
        h('div', { class: 'sub' }, `Your prediction streak: ${v.me.stats.predStreak} · ${v.counts.predictors} ${v.counts.predictors === 1 ? 'person has' : 'people have'} predicted`),
      ),
    );
  }

  /** Navigate to the newest Day's post. */
  goToCurrent(): void {
    const url = this.view.current.url;
    if (url) navigateTo(url);
  }
}
