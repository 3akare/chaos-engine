/**
 * The game screen. One frame: Solo/Team switch on top, the board, the dock.
 *
 * Solo: your own copy of today's machine with every piece it has. Build, press ▶, the three
 *   balls roll, you get stars. Your best is saved. Nobody else sees your board.
 * Team: the same machine, shared by everyone in the subreddit. Pieces are split between
 *   today's builders, nobody can make it worse, and at 02:00 UTC the three balls roll for real.
 */
import { navigateTo } from '@devvit/web/client';
import { parseCell } from '../../shared/coords';
import type { DayView, SoloPiece, StoredPiece } from '../../shared/protocol';
import { boardPieces, decide, holdersFrom, type BoardState, type Decision } from '../../shared/rules/placement';
import { levelOf } from '../../shared/sim/board';
import type { Level } from '../../shared/sim/level';
import { DAY_BALLS, runBalls, type DayRun } from '../../shared/sim/runDay';
import { PIECE_DIRS, PIECE_TYPES, W, type BoardPiece, type Dir, type PieceType, type SimResult } from '../../shared/types';
import { api } from '../lib/api';
import type { BoardScene, ScenePiece } from './scenes/BoardScene';
import { ballRow, confetti, rollThree, scoreTitle, starRow } from './show';
import { cardOpen, clearTag, closeCard, fmtCountdown, h, ico, pieceImg, showCard, spr, tag } from './ui/dom';
import { howToPlay, reportModal, welcome } from './ui/modals';
import { markWelcomed, welcomeSeen } from './ui/welcome';

const POLL_MS = 15_000;
export const PIECE_NAME: Record<PieceType, string> = { RAMP: 'Ramp', SPRING: 'Spring', FAN: 'Fan', BUMPER: 'Kicker' };

export type PlayMode = 'solo' | 'team';
/** A piece being placed or edited. `from`: (team) which of your pieces moves here. */
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
  const m = q ?? store.get('ce_mode');
  return m === 'team' ? 'team' : 'solo';
}

export class GameApp {
  view!: DayView;
  level!: Level;
  private mode: PlayMode = initialMode();
  private skew = 0;
  private edit: Edit | null = null;
  private busy = false;
  private rolling = false;
  private solo: Record<string, { type: PieceType; dir: Dir }> = {};
  private els: { tabs: HTMLElement; pill: HTMLElement; board: HTMLElement; dock: HTMLElement; top: HTMLElement };

  constructor(
    root: HTMLElement,
    private scene: BoardScene,
    private postId: string | undefined,
  ) {
    const tab = (m: PlayMode, label: string): HTMLButtonElement => h('button', { class: 'tab', 'data-mode': m, onclick: () => this.switchMode(m) }, label);
    const tabs = h('div', { class: 'tabs', role: 'tablist' }, tab('solo', 'Solo'), tab('team', 'Team'));
    const pill = h('div', { class: 'pill' });
    const top = h('header', { class: 'top' }, tabs, pill);
    const board = h('div', { id: 'board' });
    const dock = h('nav', { class: 'dock' });
    root.append(top, board, dock);
    this.els = { tabs, pill, board, dock, top };
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
      welcome(() => this.afterWelcome());
    } else this.afterWelcome();
    window.setInterval(() => this.tickPill(), 1000);
    window.setInterval(() => void this.poll(), POLL_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.poll();
    });
  }

  boardElement(): HTMLElement {
    return this.els.board;
  }

  private afterWelcome(): void {
    if (this.mode === 'team') this.teamHello();
  }

  private now(): number {
    return Date.now() + this.skew;
  }

  private setView(v: DayView): void {
    const newDay = !this.view || this.view.day.dayId !== v.day.dayId;
    if (newDay) {
      this.level = levelOf({ ...v.level, solution: [] });
      this.loadSolo(v.day.dayId);
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
    if (m === 'team') this.teamHello();
  }

  /** Draw everything for the current mode and state. */
  private render(): void {
    for (const b of this.els.tabs.querySelectorAll<HTMLElement>('.tab')) b.classList.toggle('on', b.dataset.mode === this.mode);
    this.els.board.querySelector('.spinner')?.remove();
    this.tickPill();
    if (this.mode === 'solo') {
      this.scene.setBoard(this.level, this.soloScenePieces(), this.view.level.target ?? 'bell');
      this.scene.onTap = (x, y) => this.onTap(x, y);
      this.toIdle();
      return;
    }
    const v = this.view;
    const open = v.day.status === 'OPEN' && v.serverNow < v.day.locksAt;
    this.scene.setBoard(this.level, this.teamScenePieces(), v.level.target ?? 'bell');
    if (open) {
      this.scene.onTap = (x, y) => this.onTap(x, y);
      this.toIdle();
    } else if (!v.result) {
      this.scene.onTap = null;
      this.scene.setGhost(undefined, undefined);
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
    if (this.mode === 'solo') {
      const best = this.view.solo.best;
      pill.replaceChildren(h('span', {}, 'Best'), ...[0, 1, 2].map((i) => spr('star', best !== null && i < best ? '' : 'miss')));
      return;
    }
    const v = this.view;
    const left = v.day.locksAt - this.now();
    if (v.day.status === 'OPEN' && left > 0) pill.replaceChildren(h('span', {}, `Rolls in ${fmtCountdown(left)}`));
    else if (v.result) pill.replaceChildren(h('span', {}, 'Team'), ...[0, 1, 2].map((i) => spr('star', i < v.result!.score ? '' : 'miss')));
    else pill.replaceChildren(h('span', {}, 'Rolling'));
    if (v.day.status === 'OPEN' && left <= 0 && left > -1500 && !this.busy) void this.poll();
  }

  async poll(): Promise<void> {
    if (document.visibilityState !== 'visible' || this.scene.isPlaying() || this.rolling || this.edit || this.busy) return;
    const r = await api.state(this.postId);
    if (!r.ok) return;
    const sameDay = r.data.day.dayId === this.view.day.dayId;
    // Solo boards and finished days don't change under you: just refresh the numbers.
    if (sameDay && (this.mode === 'solo' || (this.view.result && r.data.result) || cardOpen())) {
      this.view = r.data;
      this.tickPill();
    } else this.setView(r.data);
  }

  // ---------- pieces on the board ----------

  private loadSolo(dayId: string): void {
    try {
      this.solo = JSON.parse(store.get(`ce_solo_${dayId}`) ?? '{}') as GameApp['solo'];
    } catch {
      this.solo = {};
    }
  }
  private saveSolo(): void {
    store.set(`ce_solo_${this.view.day.dayId}`, JSON.stringify(this.solo));
  }

  private soloBoard(): BoardPiece[] {
    return Object.entries(this.solo).map(([socket, p], i) => {
      const c = parseCell(socket)!;
      return { id: `solo${i}-${socket}`, type: p.type, dir: p.dir, x: c[0], y: c[1] };
    });
  }

  private soloScenePieces(edit?: Edit): ScenePiece[] {
    const out: ScenePiece[] = this.soloBoard()
      .filter((p) => !edit || cellName(p.x, p.y) !== edit.socket)
      .map((p) => ({ ...p }));
    if (edit) out.push(this.ghostPiece(edit));
    return out;
  }

  private teamScenePieces(edit?: Edit): ScenePiece[] {
    const me = this.view.me.userId;
    const out: ScenePiece[] = [];
    for (const p of this.view.pieces) {
      if (edit && (p.socket === edit.socket || p.socket === edit.from)) continue;
      const c = parseCell(p.socket)!;
      out.push({ id: p.pieceId, type: p.type, dir: p.dir, x: c[0], y: c[1], owner: p.username, setup: p.setup === true, mine: p.userId === me && !p.setup });
    }
    if (edit) out.push(this.ghostPiece(edit));
    return out;
  }

  private ghostPiece(e: Edit): ScenePiece {
    const c = parseCell(e.socket)!;
    return { id: 'edit', type: e.type, dir: e.dir, x: c[0], y: c[1], ghost: true, mine: true };
  }

  private scenePieces(edit?: Edit): ScenePiece[] {
    return this.mode === 'solo' ? this.soloScenePieces(edit) : this.teamScenePieces(edit);
  }

  /** The pieces on the board right now, for the sim. */
  private boardNow(): BoardPiece[] {
    if (this.mode === 'solo') return this.soloBoard();
    return boardPieces(this.teamState().pieces);
  }

  private teamState(): BoardState {
    const pieces: Record<string, StoredPiece> = {};
    for (const p of this.view.pieces) pieces[p.socket] = p;
    return { pieces, inventory: { ...this.view.inventory }, holders: holdersFrom(pieces) };
  }

  private redRun(pieces = this.boardNow()): SimResult {
    return runBalls({ level: this.level, pieces }, DAY_BALLS).balls[0];
  }

  /** How many of each piece are left to place. */
  private stock(t: PieceType): number {
    if (this.mode === 'team') return this.view.inventory[t];
    const used = Object.values(this.solo).filter((p) => p.type === t).length;
    return (this.view.level.inventory[t] ?? 0) - used;
  }

  private piecesLeft(): number {
    if (this.mode === 'solo') return PIECE_TYPES.reduce((a, t) => a + Math.max(0, this.stock(t)), 0);
    return Math.max(0, this.view.me.allowance - this.view.me.sockets.length);
  }

  // ---------- dock ----------

  private key(cls: string, label: string, onclick: () => void, ...kids: Array<Node | string | null>): HTMLButtonElement {
    return h('button', { class: `key ${cls}`, 'aria-label': label, onclick }, ...kids);
  }

  private toIdle(): void {
    this.edit = null;
    clearTag();
    this.scene.setHighlights([]);
    this.scene.setPieces(this.scenePieces());
    this.scene.setGhost(this.redRun(), undefined);
    const left = this.piecesLeft();
    const play = this.mode === 'solo' ? 'Play: roll all 3 balls' : 'Test: roll all 3 balls';
    this.els.dock.className = 'dock';
    this.els.dock.replaceChildren(
      this.key('', left === 1 ? '1 piece to place' : `${left} pieces to place`, () => this.hintSpots(), spr('spot'), h('span', { class: 'badge' }, String(left))),
      this.key('go', play, () => void this.play(), ico('right')),
      this.key('blue', 'How to play', () => howToPlay(), ico('question')),
    );
  }

  private hintSpots(): void {
    const all: Array<[number, number]> = [];
    for (let i = 0; i < this.level.socket.length; i++) if (this.level.socket[i]) all.push([i % W, Math.floor(i / W)]);
    this.scene.setHighlights(all);
    const left = this.piecesLeft();
    tag(left > 0 ? `Tap a + to place ${left === 1 ? 'your piece' : `your ${left} pieces`}` : 'Tap one of your pieces to move it');
    window.setTimeout(() => {
      if (!this.edit) this.scene.setHighlights([]);
    }, 1600);
  }

  private teamHello(): void {
    if (this.mode !== 'team') return;
    const v = this.view;
    if (v.day.status !== 'OPEN') return;
    const n = Math.max(v.counts.builders, 1);
    const k = v.me.allowance;
    tag(`${n} ${n === 1 ? 'builder' : 'builders'} today · you can place ${k}`, 'same');
    if (v.me.inbox.length) reportModal(v.me.inbox, () => void api.ackInbox(this.postId));
  }

  // ---------- rolling the three balls ----------

  private async play(): Promise<void> {
    if (this.rolling) return;
    this.rolling = true;
    clearTag();
    const pieces = this.boardNow();
    const run = runBalls({ level: this.level, pieces }, DAY_BALLS);
    this.scene.setGhost(undefined, undefined);
    const mine = new Set(this.mode === 'solo' ? pieces.map((p) => p.id) : this.view.pieces.filter((p) => !p.setup).map((p) => p.pieceId));
    await rollThree(run, { scene: this.scene, board: this.els.board, dock: this.els.dock, playerPieceIds: mine, target: this.level.target, showOwners: this.mode === 'team' });
    this.rolling = false;
    if (this.mode === 'solo') await this.soloResult(run);
    else this.testResult(run);
    this.toIdle();
  }

  private async soloResult(run: DayRun): Promise<void> {
    const pieces: SoloPiece[] = Object.entries(this.solo).map(([socket, p]) => ({ socket, ...p }));
    const r = await api.solo({ postId: this.postId ?? this.view.day.postId ?? undefined, pieces });
    if (r.ok) this.view.solo = { best: r.data.best, players: r.data.players, perfect: r.data.perfect };
    this.tickPill();
    if (run.score > 0) confetti(this.els.board, run.score * 14);
    const others = this.view.solo.players - 1;
    const note = run.score === 3 ? (others > 0 ? `${this.view.solo.perfect} of ${this.view.solo.players} players got all 3` : 'All three made it!') : run.score === 0 ? 'Change your pieces so the balls reach the flag' : 'Try to get every ball home';
    showCard(
      h(
        'div',
        {},
        h('h2', {}, scoreTitle(run.score)),
        starRow(run),
        ballRow(run),
        h('p', { class: 'note' }, note),
        run.score === 3 ? h('button', { class: 'key cta2 hud', onclick: () => this.switchMode('team') }, 'Now build it with the team') : null,
      ),
      run.score === 3 ? 'Play again' : 'Keep building',
    );
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
    const run = runBalls({ level: this.level, pieces: boardPieces(this.teamState().pieces) }, DAY_BALLS);
    const seenKey = `ce_seen_${v.day.dayId}`;
    const seen = store.get(seenKey) === '1';
    store.set(seenKey, '1');
    const watch = async (): Promise<void> => {
      if (this.rolling) return;
      this.rolling = true;
      closeCard();
      await rollThree(run, { scene: this.scene, board: this.els.board, dock: this.els.dock, playerPieceIds: new Set(v.pieces.filter((p) => !p.setup).map((p) => p.pieceId)), target: this.level.target, showOwners: true });
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
    this.els.dock.className = 'dock';
    this.els.dock.replaceChildren(this.key('go wide hud', 'Watch again', () => void watch(), 'Watch again'));
    if (r.score > 0) confetti(this.els.board, r.score * 14);
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

  // ---------- placing ----------

  private onTap(x: number, y: number): void {
    if (this.scene.isPlaying() || this.busy || this.rolling) return;
    if (!this.level.socket[y * W + x]) {
      if (this.edit) this.toIdle();
      return;
    }
    const socket = cellName(x, y);
    if (this.mode === 'solo') return this.soloEdit(socket);
    if (!this.view.me.userId) return tag('Log in to Reddit to build with the team', 'bad');
    const occupant = this.view.pieces.find((p) => p.socket === socket);
    if (occupant && (occupant.userId !== this.view.me.userId || occupant.setup)) return this.toOther(occupant);
    this.teamEdit(socket);
  }

  private firstInStock(): PieceType | null {
    return PIECE_TYPES.find((t) => this.stock(t) > 0) ?? null;
  }

  private soloEdit(socket: string): void {
    const own = this.solo[socket];
    const keep = this.edit;
    const type = own?.type ?? (keep && this.stock(keep.type) > 0 ? keep.type : this.firstInStock());
    if (!type) return tag('All pieces are placed. Tap one to change it', 'same');
    let dir = own?.dir ?? (keep?.type === type ? keep.dir : PIECE_DIRS[type][0]!);
    if (!PIECE_DIRS[type].includes(dir)) dir = PIECE_DIRS[type][0]!;
    this.edit = { socket, type, dir, from: null };
    this.renderEdit();
  }

  private teamEdit(socket: string): void {
    const mine = this.view.pieces.filter((p) => p.userId === this.view.me.userId && !p.setup);
    const occupant = this.view.pieces.find((p) => p.socket === socket);
    const ownTarget = occupant && occupant.userId === this.view.me.userId && !occupant.setup ? occupant : undefined;
    const keep = this.edit;
    let from: string | null = ownTarget ? null : (keep?.from ?? null);
    if (!ownTarget && from === null && mine.length >= this.view.me.allowance && mine.length > 0) from = mine[mine.length - 1]!.socket;
    const base = ownTarget ?? (from ? this.view.pieces.find((p) => p.socket === from) : undefined);
    const type: PieceType = ownTarget?.type ?? keep?.type ?? base?.type ?? this.firstInStock() ?? 'RAMP';
    let dir: Dir = ownTarget?.dir ?? (keep?.type === type ? keep.dir : undefined) ?? base?.dir ?? PIECE_DIRS[type][0]!;
    if (!PIECE_DIRS[type].includes(dir)) dir = PIECE_DIRS[type][0]!;
    this.edit = { socket, type, dir, from };
    this.renderEdit();
  }

  /** Someone else's piece on the team board: who placed it, and a way to replace it. */
  private toOther(p: StoredPiece): void {
    this.scene.setHighlights([parseCell(p.socket)!]);
    tag(p.setup ? 'This piece came with the machine' : `u/${p.username} put this here`);
    this.els.dock.className = 'dock';
    this.els.dock.replaceChildren(this.key('no', 'Back', () => this.toIdle(), ico('cross')), this.key('blue wide hud', 'Replace it with a better one', () => this.teamEdit(p.socket), 'Replace'));
  }

  private teamDecision(): Decision | null {
    const e = this.edit;
    if (!e || !this.view.me.userId) return null;
    return decide(this.level, this.teamState(), { userId: this.view.me.userId, username: this.view.me.username ?? 'you' }, { kind: 'set', socket: e.socket, type: e.type, dir: e.dir, from: e.from ?? undefined }, this.now(), 'edit', {
      piecesNeeded: this.view.me.piecesNeeded,
    });
  }

  /** The pieces with the edit applied (for the yellow preview path). */
  private previewPieces(): BoardPiece[] {
    const e = this.edit!;
    const c = parseCell(e.socket)!;
    const keep = this.boardNow().filter((p) => {
      const n = cellName(p.x, p.y);
      return n !== e.socket && n !== e.from;
    });
    return [...keep, { id: 'edit', type: e.type, dir: e.dir, x: c[0], y: c[1] }];
  }

  /** Stock for the tray: what's left, plus the piece being edited (it goes back if you change it). */
  private trayStock(t: PieceType): number {
    const e = this.edit!;
    if (this.mode === 'solo') return this.stock(t) + (this.solo[e.socket]?.type === t ? 1 : 0);
    const own = this.view.pieces.find((p) => p.socket === e.socket) ?? (e.from ? this.view.pieces.find((p) => p.socket === e.from) : undefined);
    return this.view.inventory[t] + (own?.type === t ? 1 : 0);
  }

  private renderEdit(): void {
    const e = this.edit!;
    this.scene.setHighlights([]);
    this.scene.setPieces(this.scenePieces(e));
    const after = this.redRun(this.previewPieces());
    this.scene.setGhost(this.redRun(), after);

    const tiles = PIECE_TYPES.filter((t) => this.trayStock(t) > 0 || t === e.type).map((t) => {
      const sel = t === e.type;
      const n = this.trayStock(t) - (sel ? 1 : 0);
      return h(
        'button',
        {
          class: `key tile${sel ? ' sel' : ''}`,
          'aria-label': sel ? `${PIECE_NAME[t]}: tap to turn it` : PIECE_NAME[t],
          onclick: () => {
            if (sel) {
              const dirs = PIECE_DIRS[t];
              e.dir = dirs[(dirs.indexOf(e.dir) + 1) % dirs.length]!;
            } else {
              e.type = t;
              e.dir = PIECE_DIRS[t].includes(e.dir) ? e.dir : PIECE_DIRS[t][0]!;
            }
            this.renderEdit();
          },
        },
        h('span', { class: 'pic' }, pieceImg(t, sel ? e.dir : PIECE_DIRS[t][0]!), t === 'FAN' ? h('span', { class: `wind w-${sel ? e.dir : 'R'}` }, ico('arrowRight')) : null),
        h('span', { class: 'name' }, PIECE_NAME[t]),
        n > 0 ? h('span', { class: 'badge' }, `×${n}`) : null,
      );
    });

    let ok = true;
    if (this.mode === 'solo') {
      tag(after.end === 'success' ? 'The red ball reaches the flag!' : 'Tap the piece again to turn it', after.end === 'success' ? 'good' : 'same', true);
    } else {
      const d = this.teamDecision();
      ok = !!d && d.ok;
      if (!d) tag('Log in to play', 'bad', true);
      else if (d.ok) tag(d.after[0] ? 'The red ball reaches the flag!' : d.verdict.kind === 'better' ? 'Gets closer!' : 'Doesn’t help yet: tap it to turn it', d.verdict.kind === 'better' ? 'good' : 'same', true);
      else if (d.code === 'NO_CHANGE') tag('Tap the piece again to turn it', 'same', true);
      else if (d.code === 'MUST_IMPROVE') tag('Only a better piece can replace it', 'bad', true);
      else if (d.code === 'WOULD_HURT') tag('That makes it worse for the team', 'bad', true);
      else if (d.code === 'OUT_OF_STOCK') tag('None left', 'bad', true);
      else tag(d.message, 'bad', true);
    }

    const existing = this.mode === 'solo' ? !!this.solo[e.socket] : !!this.view.pieces.find((p) => p.socket === e.socket && p.userId === this.view.me.userId && !p.setup);
    const left = existing ? this.key('no', 'Remove this piece', () => void this.removePiece(), ico('trashcan')) : this.key('no', 'Cancel', () => this.toIdle(), ico('cross'));
    const place = this.key('go', 'Place it', () => void this.confirm(), ico('checkmark'));
    place.disabled = !ok || this.busy;
    this.els.dock.className = 'dock tight';
    this.els.dock.replaceChildren(left, ...tiles, place);
  }

  private async confirm(): Promise<void> {
    const e = this.edit;
    if (!e || this.busy) return;
    if (this.mode === 'solo') {
      this.solo[e.socket] = { type: e.type, dir: e.dir };
      this.saveSolo();
      this.toIdle();
      return;
    }
    this.busy = true;
    const r = await api.place({ postId: this.postId ?? this.view.day.postId ?? undefined, socketId: e.socket, type: e.type, dir: e.dir, from: e.from ?? undefined });
    this.busy = false;
    if (!r.ok) {
      tag(r.error.message, 'bad');
      const fresh = await api.state(this.postId);
      if (fresh.ok) this.view = fresh.data;
      if (this.edit) this.renderEdit();
      return;
    }
    this.edit = null;
    this.setView(r.data.state);
  }

  private async removePiece(): Promise<void> {
    const e = this.edit;
    if (!e || this.busy) return;
    if (this.mode === 'solo') {
      delete this.solo[e.socket];
      this.saveSolo();
      this.toIdle();
      return;
    }
    this.busy = true;
    const r = await api.remove(this.postId ?? this.view.day.postId ?? undefined, e.socket);
    this.busy = false;
    if (!r.ok) return tag(r.error.message, 'bad');
    this.edit = null;
    this.setView(r.data.state);
  }

  goToCurrent(): void {
    closeCard();
    const url = this.view.current.url;
    if (url) navigateTo(url);
  }
}

const cellName = (x: number, y: number): string => `${'ABCDEFGHI'[x]}${y + 1}`;
