/** Game controller: owns the Day view, the board scene and the DOM overlay. */
import { navigateTo } from '@devvit/web/client';
import { cellName, circled, parseCell } from '../../shared/coords';
import type { DayView, StoredPiece } from '../../shared/protocol';
import { ball1, decide, pieceName, type BoardState, type Decision } from '../../shared/rules/placement';
import { describeEnd } from '../../shared/rules/explain';
import { levelOf } from '../../shared/sim/board';
import type { Level } from '../../shared/sim/level';
import { PIECE_DIRS, PIECE_TYPES, W, type Dir, type PieceType, type SimResult } from '../../shared/types';
import { api } from '../lib/api';
import type { BoardScene, ScenePiece } from './scenes/BoardScene';
import { coachSeen, runCoach } from './ui/coach';
import { closeModal, closeSheet, fmtCountdown, h, sheetOpen, showSheet, toast } from './ui/dom';
import { PIECE_LABEL, pieceIcon } from './ui/icons';
import { howToPlay, pieceCard, reportModal, sealInfo } from './ui/modals';
import { RunScreen } from './run';

const POLL_MS = 15_000;
const KIND_NAMES: Record<string, string> = { solid: 'a wall', start: 'the start chute', target: 'the goal', checkpoint: 'a checkpoint', switch: 'a switch', gate: 'a gate', empty: 'empty air' };

type Candidate = { socket: string; type: PieceType; dir: Dir };

export class GameApp {
  view!: DayView;
  level!: Level;
  private skew = 0;
  private speed = 1;
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
    const title = h('div', { class: 'hud-title' });
    const help = h('button', { class: 'icon-btn', 'aria-label': 'How to play', onclick: () => howToPlay() }, '?');
    const chips = h('div', { class: 'chips' });
    const status = h('div', { class: 'status-line', 'aria-live': 'polite' });
    const overlay = h('div', { class: 'overlay' });
    const board = h('div', { id: 'board' }, overlay);
    const bar = h('div', { class: 'bar' });
    const countdown = h('span', {});
    this.root.append(h('div', { class: 'hud' }, h('div', { class: 'hud-top' }, title, help), chips, status), board, bar);
    this.els = { title, chips, status, bar, board, overlay, countdown };
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
    const next = (): void => this.showInbox();
    if (!coachSeen()) {
      const rect = (sel: string) => () => document.querySelector(sel)?.getBoundingClientRect() ?? null;
      runCoach(
        [
          { text: 'This machine is broken. Run it.', target: rect('[data-act="test"]') },
          { text: 'Add one piece to help.', target: () => this.boardElement().getBoundingClientRect(), below: false },
          { text: 'At lock, three balls fire. Two are secret.', target: rect('[data-act="seal"]'), below: true },
        ],
        next,
      );
    } else next();
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
    const verb = this.view.level.target === 'basket' ? 'Fill the basket' : 'Ring the bell';
    if (this.view.level.objective.type === 'CHECKPOINTS_THEN_DELIVER') {
      const n = this.view.level.objective.count;
      return `${icon} ${verb} after ${Array.from({ length: n }, (_, i) => circled(i + 1)).join('')}`;
    }
    return `${icon} ${verb}`;
  }

  private renderHud(): void {
    const v = this.view;
    const tier = v.level.gen?.tier ?? 1;
    this.els.title.replaceChildren(`Day ${v.day.dayNumber} · ${v.level.name} `, h('span', { class: 'gears', title: `Difficulty ${tier} of 3`, 'aria-label': `Difficulty ${tier} of 3` }, '⚙'.repeat(tier)));
    const open = v.day.status === 'OPEN';
    const chips: HTMLElement[] = [h('span', { class: 'chip goal' }, this.goalText())];
    if (open) chips.push(h('span', { class: 'chip', title: 'Time until the machine locks and fires' }, '⏱ ', this.els.countdown));
    chips.push(h('button', { class: 'chip', 'data-act': 'seal', onclick: () => sealInfo(v) }, v.result ? '🔓 Seal opened' : `🔒 Sealed: ${v.day.commitHash.slice(0, 4)}…`));
    chips.push(h('span', { class: 'chip' }, `👷 ${v.counts.builders} ${v.counts.builders === 1 ? 'engineer' : 'engineers'}`));
    if (v.counts.predictors) chips.push(h('span', { class: 'chip' }, `🔮 ${v.counts.predictors}`));
    this.els.chips.replaceChildren(...chips);
    this.tickClock();
  }

  private tickClock(): void {
    if (!this.view) return;
    const left = this.view.day.locksAt - this.now();
    this.els.countdown.textContent = fmtCountdown(left);
    if (this.view.day.status === 'OPEN' && left <= 0 && left > -1500 && !this.busy) {
      // Lock time passed: refresh into "Firing up the machine…" until the cron resolves it.
      closeSheet(true);
      void this.poll();
    }
  }

  // ---------- build mode ----------

  private boardState(): BoardState {
    const pieces: Record<string, StoredPiece> = {};
    const holders: Record<string, string> = {};
    for (const p of this.view.pieces) {
      pieces[p.socket] = p;
      if (!p.setup) holders[p.userId] = p.socket;
    }
    return { pieces, inventory: { ...this.view.inventory }, holders };
  }

  private scenePieces(extra?: Candidate): ScenePiece[] {
    const me = this.view.me.userId;
    const out: ScenePiece[] = [];
    for (const p of this.view.pieces) {
      const c = parseCell(p.socket)!;
      if (extra && (p.socket === extra.socket || (p.userId === me && !p.setup))) continue;
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
    this.els.status.textContent = r.end === 'success' ? 'Right now: Ball 1 delivers ✓' : `Right now: Ball 1 ${describeEnd(r)}`;
    if (!this.candidate) this.scene.setGhost(r, undefined);
  }

  private renderBuildBar(): void {
    const me = this.view.me;
    const pred = me.prediction;
    this.els.bar.replaceChildren(
      h('button', { class: 'btn primary', 'data-act': 'test', onclick: () => void this.testRun() }, '▶ Test run', h('span', { class: 'sub', onclick: (e: Event) => this.cycleSpeed(e) }, `${this.speed}×`)),
      h('button', { class: 'btn', 'data-act': 'place', onclick: () => this.placeHint() }, me.socket ? '✥ Move my piece' : '➕ Place'),
      h('button', { class: 'btn', 'data-act': 'predict', onclick: () => this.predictSheet() }, pred === null ? '🔮 Predict' : `🔮 ${pred}/3`),
    );
  }

  private cycleSpeed(e: Event): void {
    e.stopPropagation();
    this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 4 : 1;
    this.renderBuildBar();
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
    if (btn) btn.firstChild!.textContent = '■ Stop ';
    await this.scene.playRun(r, { speed: this.speed, showOwners: true });
    if (btn) btn.firstChild!.textContent = '▶ Test run';
    this.els.status.textContent = r.end === 'success' ? 'Ball 1 delivers ✓' : `Ball 1 ${describeEnd(r)}`;
    if (this.candidate) this.updatePreview();
    else this.scene.setGhost(r, undefined);
  }

  private placeHint(): void {
    const free: Array<[number, number]> = [];
    for (let i = 0; i < this.level.socket.length; i++) if (this.level.socket[i]) free.push([i % W, Math.floor(i / W)]);
    this.scene.setHighlights(free);
    const mine = this.view.pieces.find((p) => p.userId === this.view.me.userId && !p.setup);
    toast(mine ? `Tap any socket to move your ${pieceName(mine.type)}, or tap it to turn it.` : 'Tap a dashed socket to add your piece.');
    window.setTimeout(() => this.scene.setHighlights([]), 2400);
  }

  private onTap(x: number, y: number): void {
    if (this.scene.isPlaying()) return;
    const name = cellName(x, y);
    const i = y * W + x;
    if (!this.level.socket[i]) {
      const k = this.level.kinds[i] ?? 'empty';
      this.els.status.textContent = `${name} is ${KIND_NAMES[k] ?? 'part of the machine'}. Pieces go in dashed sockets.`;
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
    const own = this.view.pieces.find((p) => p.userId === this.view.me.userId && !p.setup);
    const occupant = this.view.pieces.find((p) => p.socket === socket);
    const keep = this.candidate;
    let type: PieceType = keep?.type ?? own?.type ?? occupant?.type ?? 'RAMP';
    let dir: Dir = keep?.dir ?? own?.dir ?? occupant?.dir ?? PIECE_DIRS[type][0]!;
    if (occupant && own && occupant.socket === own.socket) {
      type = own.type;
      dir = own.dir;
    }
    if (!PIECE_DIRS[type].includes(dir)) dir = PIECE_DIRS[type][0]!;
    this.candidate = { socket, type, dir };
    this.scene.setHighlights([parseCell(socket)!]);
    this.renderPalette();
  }

  private candidateDecision(): Decision | null {
    const c = this.candidate;
    if (!c || !this.view.me.userId) return null;
    return decide(this.level, this.boardState(), { userId: this.view.me.userId, username: this.view.me.username ?? 'you' }, { kind: 'set', socket: c.socket, type: c.type, dir: c.dir }, this.now(), 'candidate');
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
    const own = this.view.pieces.find((p) => p.userId === this.view.me.userId && !p.setup);
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
    const own = view.pieces.find((p) => p.userId === view.me.userId && !p.setup);
    const occupant = view.pieces.find((p) => p.socket === c.socket);
    const replacing = occupant && occupant !== own;
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
      heading = `Replace ${occupant!.setup ? 'the setup' : `u/${occupant!.username}'s`} ${pieceName(occupant!.type)} at ${c.socket}`;
      sub = 'Your version must give Ball 1 strictly better progress.';
    } else if (own && own.socket === c.socket) {
      heading = `Your ${pieceName(own.type)} at ${c.socket}`;
      sub = 'Turn it or swap its type. It must not lower Ball 1’s progress.';
    } else if (own) {
      heading = `Move your ${pieceName(own.type)} to ${c.socket}`;
      sub = `It leaves ${own.socket}. Ball 1 must not do worse.`;
    } else {
      heading = `Add a piece at ${c.socket}`;
      sub = 'Tap a piece, tap again to turn it. Ball 1 must not do worse.';
    }

    let verdictEl: HTMLElement;
    let canConfirm = false;
    if (!d) verdictEl = h('div', { class: 'verdict' }, 'Log in to Reddit to build.');
    else if (d.ok) {
      canConfirm = true;
      const icon = d.verdict.kind === 'better' ? '✅' : '☑️';
      verdictEl = h('div', { class: `verdict ${d.verdict.kind}`, role: 'status' }, h('span', { class: 'vi' }, icon), h('div', {}, h('b', {}, d.verdict.label), ' ', d.verdict.reason));
    } else if (d.code === 'NO_CHANGE') {
      verdictEl = h('div', { class: 'verdict' }, h('span', { class: 'vi' }, '👆'), h('div', {}, 'That’s your piece as it is. Tap a piece type to change it, or tap another socket to move it.'));
    } else {
      const label = d.verdict ? d.verdict.label : 'Not allowed ✗';
      verdictEl = h('div', { class: 'verdict lower', role: 'status' }, h('span', { class: 'vi' }, '⛔'), h('div', {}, h('b', {}, label), ' ', d.verdict ? d.verdict.reason : d.message, d.code === 'MUST_IMPROVE' ? ' Replacing needs strictly better.' : ''));
    }

    const buttons = h(
      'div',
      { class: 'row' },
      h('button', { class: 'btn small', onclick: () => void this.testRun() }, '▶ Preview'),
      own && own.socket === c.socket ? h('button', { class: 'btn small', onclick: () => void this.removeMine() }, 'Remove') : null,
      h('button', { class: 'btn go', disabled: !canConfirm || this.busy, onclick: () => void this.confirm() }, this.busy ? 'Placing…' : replacing ? 'Replace ✓' : own ? 'Move here ✓' : 'Confirm ✓'),
    );
    const content = h('div', {}, h('h3', {}, heading), h('div', { class: 'sub' }, sub), palette, verdictEl, buttons);
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
      el.prepend(h('button', { class: 'icon-btn', style: 'position:absolute;right:10px;top:8px;width:32px;height:32px', 'aria-label': 'Close', onclick: () => closeSheet() }, '✕'));
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
    const r = await api.place({ postId: this.postId ?? this.view.day.postId ?? undefined, socketId: c.socket, type: c.type, dir: c.dir });
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
    const r = await api.remove(this.postId ?? this.view.day.postId ?? undefined);
    this.busy = false;
    if (!r.ok) {
      toast(r.error.message, 4000);
      return;
    }
    this.candidate = null;
    closeSheet(true);
    this.root.style.paddingBottom = '';
    this.setView(r.data.state);
    toast('Your piece is back in stock. Place it anywhere.');
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
