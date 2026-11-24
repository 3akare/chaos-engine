/**
 * The board: renders a machine and its pieces, takes taps, draws ghost paths and plays runs.
 * UI (HUD, sheets, modals) lives in the DOM overlay; this scene only knows about the board.
 */
import * as Phaser from 'phaser';
import { cellName } from '../../../shared/coords';
import type { Level } from '../../../shared/sim/level';
import { H, W, type BoardPiece, type SimEvent, type SimResult } from '../../../shared/types';
import { applyTheme, C, FONT, TICK_MS } from '../theme';
import {
  depth,
  makeBallTextures,
  pieceShadow,
  shadowRect,
  drawCheckpoint,
  drawFanBlades,
  drawGate,
  drawPiece,
  drawSocket,
  drawStart,
  drawSwitch,
  drawTarget,
  drawWall,
} from './draw';

export type ScenePiece = BoardPiece & { owner?: string; mine?: boolean; setup?: boolean; ghost?: boolean };

export type PlayOptions = {
  speed?: number;
  /** Extra slow-down factor for a tick (1 = normal, 0.35 = slow motion). */
  slowmo?: (tick: number, run: SimResult) => number;
  onEvent?: (e: SimEvent) => void;
  /** Float the owner's name over a piece the first time the ball touches it. */
  showOwners?: boolean;
  follow?: boolean;
  startTick?: number;
};

type Playback = {
  run: SimResult;
  t: number;
  tick: number;
  opts: PlayOptions;
  resolve: () => void;
  trail: Array<{ x: number; y: number }>;
  shownOwners: Set<string>;
  lift?: number;
};

const DPR = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);

export class BoardScene extends Phaser.Scene {
  private level: Level | null = null;
  private targetKind: 'bell' | 'basket' = 'bell';
  private pieces: ScenePiece[] = [];
  private cell = 36;
  private ox = 0;
  private oy = 0;
  private gutter = 16;
  showLabels = false;

  private floorG!: Phaser.GameObjects.Graphics;
  private shadowG!: Phaser.GameObjects.Graphics;
  private staticG!: Phaser.GameObjects.Graphics;
  private ballShadow!: Phaser.GameObjects.Image;
  private ballImg!: Phaser.GameObjects.Image;
  private beamG!: Phaser.GameObjects.Graphics;
  private ghostG!: Phaser.GameObjects.Graphics;
  private trailG!: Phaser.GameObjects.Graphics;
  private hiG!: Phaser.GameObjects.Graphics;
  private labels: Phaser.GameObjects.Text[] = [];
  private cpTexts: Phaser.GameObjects.Text[] = [];
  private dynamic = new Map<number, Phaser.GameObjects.Graphics>();
  private pieceObjs = new Map<string, Phaser.GameObjects.Container>();
  private blades: Array<{ g: Phaser.GameObjects.Graphics; id: string }> = [];
  private ball!: Phaser.GameObjects.Container;
  private ballG!: Phaser.GameObjects.Graphics;
  private fx!: Phaser.GameObjects.Container;
  private play: Playback | null = null;
  private ghost: { old?: SimResult | undefined; now?: SimResult | undefined } = {};
  private highlights = new Set<number>();
  private gateState: boolean[] = [];
  private fired = new Set<number>();
  private cpDone = 0;
  private bladeBoost = new Map<string, number>();
  private resizeCb: (() => void) | null = null;

  onTap: ((x: number, y: number) => void) | null = null;
  onReady: (() => void) | null = null;

  constructor() {
    super('board');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('rgba(0,0,0,0)');
    applyTheme();
    this.floorG = this.add.graphics();
    this.shadowG = this.add.graphics();
    this.staticG = this.add.graphics();
    this.beamG = this.add.graphics();
    this.hiG = this.add.graphics();
    this.ghostG = this.add.graphics();
    this.trailG = this.add.graphics();
    this.ball = this.add.container(0, 0);
    this.ballG = this.add.graphics();
    this.ball.add(this.ballG);
    this.ball.setDepth(50);
    this.ball.setVisible(false);
    this.ballShadow = this.add.image(0, 0, '__WHITE').setDepth(45).setVisible(false);
    // Follow the device theme live.
    if (typeof matchMedia !== 'undefined') {
      matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        applyTheme();
        this.redraw();
      });
    }
    this.fx = this.add.container(0, 0).setDepth(60);
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (p.getDistance() > 12) return;
      const x = Math.floor((p.worldX - this.ox) / this.cell);
      const y = Math.floor((p.worldY - this.oy) / this.cell);
      if (x >= 0 && x < W && y >= 0 && y < H) this.onTap?.(x, y);
    });
    this.resizeCb = () => this.layout();
    this.scale.on('resize', this.resizeCb);
    this.layout();
    this.onReady?.();
  }

  // ---------- public API ----------

  setBoard(level: Level, pieces: ScenePiece[], targetKind: 'bell' | 'basket' = 'bell'): void {
    const changedLevel = level !== this.level;
    this.level = level;
    this.targetKind = targetKind;
    this.pieces = pieces;
    if (changedLevel) this.resetDynamic();
    this.redraw();
  }

  setPieces(pieces: ScenePiece[]): void {
    this.pieces = pieces;
    this.drawPieces();
    this.drawBeams();
  }

  setHighlights(cells: Array<[number, number]>): void {
    this.highlights = new Set(cells.map(([x, y]) => y * W + x));
    this.drawHighlights();
  }

  setGhost(old: SimResult | undefined, now: SimResult | undefined): void {
    this.ghost = { old, now };
    this.drawGhost();
  }

  /** Board-space centre of a cell in screen pixels (for DOM overlays). */
  cellCenter(x: number, y: number): { x: number; y: number } {
    const cam = this.cameras.main;
    const wx = this.ox + (x + 0.5) * this.cell;
    const wy = this.oy + (y + 0.5) * this.cell;
    return { x: (wx - cam.worldView.x) * cam.zoom, y: (wy - cam.worldView.y) * cam.zoom };
  }

  get cellSize(): number {
    return this.cell;
  }

  isPlaying(): boolean {
    return this.play !== null;
  }

  stop(): void {
    if (!this.play) return;
    const p = this.play;
    this.play = null;
    this.ball.setVisible(false);
    this.ballShadow.setVisible(false);
    this.trailG.clear();
    this.cameras.main.stopFollow();
    this.cameras.main.setZoom(1);
    this.cameras.main.centerOn(this.scale.width / 2, this.scale.height / 2);
    this.resetDynamic();
    p.resolve();
  }

  playRun(run: SimResult, opts: PlayOptions = {}): Promise<void> {
    this.stop();
    this.resetDynamic();
    this.fx.removeAll(true);
    return new Promise((resolve) => {
      const start = opts.startTick ?? 0;
      this.play = { run, t: start * TICK_MS, tick: start, opts, resolve, trail: [], shownOwners: new Set() };
      // Replay any events before startTick silently so gates/switches are right.
      for (const e of run.events) if (e.tick <= start) this.applyEvent(e, true);
      const f = run.frames[start]!;
      this.ball.setPosition(this.px(f.x), this.py(f.y));
      this.ball.setScale(1);
      this.ball.setAlpha(1);
      this.ball.setAngle(0);
      this.ball.setVisible(true);
      this.ballShadow.setVisible(true);
      this.placeShadow(this.ball.x, this.ball.y, 0);
      const cam = this.cameras.main;
      if (opts.follow) {
        cam.setZoom(1.35);
        cam.startFollow(this.ball, false, 0.12, 0.12);
        cam.setBounds(this.ox - this.gutter, this.oy - this.gutter, W * this.cell + this.gutter * 2, H * this.cell + this.gutter * 2);
      }
    });
  }

  // ---------- layout & drawing ----------

  private layout(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    this.gutter = this.showLabels ? Math.max(14, Math.round(Math.min(w, h) * 0.04)) : 0;
    // 20px side margin, 8px top/bottom, and a floor margin of 0.35 cell around the grid.
    const cw = Math.floor((w - this.gutter - 40) / (W + 0.7));
    const ch = Math.floor((h - this.gutter - 16) / (H + 0.7));
    this.cell = Math.max(16, Math.min(cw, ch, 72));
    const bw = this.cell * W;
    const bh = this.cell * H;
    this.ox = Math.round((w - bw + this.gutter) / 2);
    this.oy = Math.round((h - bh + this.gutter) / 2);
    this.redraw();
  }

  private px(x: number): number {
    return this.ox + (x + 0.5) * this.cell;
  }
  private py(y: number): number {
    return this.oy + (y + 0.5) * this.cell;
  }

  private resetDynamic(): void {
    if (!this.level) return;
    this.gateState = this.level.gateOpen.slice();
    this.fired = new Set();
    this.cpDone = 0;
    this.drawDynamicCells();
    this.drawBeams();
  }

  private redraw(): void {
    if (!this.staticG) return;
    this.drawStatic();
    this.drawDynamicCells();
    this.drawPieces();
    this.drawBeams();
    this.drawHighlights();
    this.drawGhost();
    this.ballG.clear();
    makeBallTextures(this, this.cell);
    this.ballImg?.destroy();
    this.ballImg = this.add.image(0, 0, 'ce-ball');
    this.ball.add(this.ballImg);
    this.ballShadow.setTexture('ce-ballshadow');
  }

  /** The ball's shadow stays on the floor; it drifts and fades as the ball lifts. */
  private placeShadow(x: number, y: number, lift: number): void {
    const s = this.cell;
    this.ballShadow.setPosition(x + s * (0.12 + lift * 0.25), y + s * (0.28 + lift * 0.35));
    this.ballShadow.setAlpha(Math.max(0.25, 0.85 - lift * 0.5));
    this.ballShadow.setScale(1 + lift * 0.25);
  }

  private drawShadows(): void {
    const g = this.shadowG;
    if (!g || !this.level) return;
    g.clear();
    g.setAlpha(C.shadowAlpha);
    g.fillStyle(C.shadow, 1);
    const s = this.cell;
    const sx = s * 0.18;
    const sy = s * 0.22;
    for (let i = 0; i < W * H; i++) {
      const k = this.level.kinds[i];
      if (k !== 'solid' && !(k === 'gate' && !this.gateState[i])) continue;
      const x = i % W;
      const y = Math.floor(i / W);
      g.translateCanvas(this.px(x), this.py(y));
      shadowRect(g, s, sx, sy);
      g.translateCanvas(-this.px(x), -this.py(y));
    }
    for (const p of this.pieces) {
      g.translateCanvas(this.px(p.x), this.py(p.y));
      pieceShadow(g, p.type, p.dir, s, sx, sy);
      g.translateCanvas(-this.px(p.x), -this.py(p.y));
    }
  }

  private drawStatic(): void {
    const g = this.staticG;
    g.clear();
    const fg = this.floorG;
    fg.clear();
    for (const t of this.labels) t.destroy();
    this.labels = [];
    const s = this.cell;
    const bw = s * W;
    const bh = s * H;
    // The floor: one soft slab with a faint dot grid.
    const m = Math.round(s * 0.35);
    fg.fillStyle(C.shadow, C.shadowAlpha * 0.5);
    fg.fillRoundedRect(this.ox - m, this.oy - m + 6, bw + m * 2, bh + m * 2, s * 0.7);
    fg.fillStyle(C.floor, 1);
    fg.fillRoundedRect(this.ox - m, this.oy - m, bw + m * 2, bh + m * 2, s * 0.7);
    // Edge labels are off by default: players found coordinates noise.
    const fs = Math.max(10, Math.min(13, Math.round(s * 0.34)));
    const style = { fontFamily: FONT, fontSize: `${fs}px`, color: '#8b7f6a', fontStyle: 'bold' };
    for (let x = 0; x < W && this.showLabels; x++) {
      const t = this.add.text(this.px(x), this.oy - this.gutter * 0.5 - 4, 'ABCDEFGHI'[x]!, style).setOrigin(0.5).setResolution(DPR);
      this.labels.push(t);
    }
    for (let y = 0; y < H && this.showLabels; y++) {
      const t = this.add.text(this.ox - this.gutter * 0.5 - 4, this.py(y), String(y + 1), style).setOrigin(0.5).setResolution(DPR);
      this.labels.push(t);
    }
    if (!this.level) return;
    const L = this.level;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const k = L.kinds[i];
        const cx = this.px(x);
        const cy = this.py(y);
        if (k === 'solid') {
          const solid = (xx: number, yy: number) => xx >= 0 && xx < W && yy >= 0 && yy < H && L.kinds[yy * W + xx] === 'solid';
          const n = { up: solid(x, y - 1), down: solid(x, y + 1), left: solid(x - 1, y), right: solid(x + 1, y) };
          this.withOffset(g, cx, cy, () => drawWall(g, s, n));
        } else if (k === 'start') {
          this.withOffset(g, cx, cy, () => drawStart(g, s, L.start.dx));
        } else if (k === 'target') {
          this.withOffset(g, cx, cy, () => drawTarget(g, s, this.targetKind));
        } else if (L.socket[i]) {
          this.withOffset(fg, cx, cy, () => drawSocket(fg, s));
        }
      }
    }
  }

  /** Graphics has no per-shape transform; temporarily shift its origin via translate. */
  private withOffset(g: Phaser.GameObjects.Graphics, x: number, y: number, fn: () => void): void {
    g.translateCanvas(x, y);
    fn();
    g.translateCanvas(-x, -y);
  }

  private drawDynamicCells(): void {
    for (const g of this.dynamic.values()) g.destroy();
    this.dynamic.clear();
    for (const t of this.cpTexts) t.destroy();
    this.cpTexts = [];
    if (!this.level) return;
    const L = this.level;
    const s = this.cell;
    for (let i = 0; i < W * H; i++) {
      const k = L.kinds[i];
      if (k !== 'gate' && k !== 'switch' && k !== 'checkpoint') continue;
      const x = i % W;
      const y = Math.floor(i / W);
      const g = this.add.graphics({ x: this.px(x), y: this.py(y) });
      if (k === 'gate') drawGate(g, s, this.gateState[i] ?? false);
      if (k === 'switch') drawSwitch(g, s, this.fired.has(i));
      if (k === 'checkpoint') {
        const n = L.cp[i]!;
        drawCheckpoint(g, s, n <= this.cpDone);
        const t = this.add
          .text(this.px(x), this.py(y), String(n), { fontFamily: FONT, fontSize: `${Math.round(s * 0.36)}px`, color: n <= this.cpDone ? '#ffffff' : `#${C.ink.toString(16).padStart(6, '0')}`, fontStyle: 'bold' })
          .setOrigin(0.5)
          .setResolution(DPR)
          .setDepth(5);
        this.cpTexts.push(t);
      }
      this.dynamic.set(i, g);
    }
  }

  private drawPieces(): void {
    for (const c of this.pieceObjs.values()) c.destroy();
    this.pieceObjs.clear();
    this.blades = [];
    const s = this.cell;
    for (const p of this.pieces) {
      const c = this.add.container(this.px(p.x), this.py(p.y)).setDepth(p.ghost ? 30 : 10);
      const g = this.add.graphics();
      drawPiece(g, p.type, p.dir, s, p.ghost ? 0.75 : 1);
      c.add(g);
      if (p.type === 'FAN') {
        const bg = this.add.graphics();
        drawFanBlades(bg, s, p.dir, p.ghost ? 0.75 : 1);
        bg.setPosition(0, -depth(s));
        c.add(bg);
        this.blades.push({ g: bg, id: p.id });
      }
      if (p.mine && !p.ghost) {
        const m = this.add.graphics();
        m.fillStyle(C.white, 1);
        m.fillCircle(s * 0.3, -s * 0.3 - depth(s), s * 0.11);
        m.fillStyle(C.pathNew, 1);
        m.fillCircle(s * 0.3, -s * 0.3 - depth(s), s * 0.07);
        c.add(m);
      }
      if (p.ghost) {
        this.tweens.add({ targets: c, alpha: { from: 0.55, to: 1 }, duration: 600, yoyo: true, repeat: -1 });
      }
      this.pieceObjs.set(p.id, c);
    }
    this.drawShadows();
  }

  /** Faint particle stripes in each fan's beam (initial gate states, standard range). */
  private drawBeams(): void {
    const g = this.beamG;
    g.clear();
    if (!this.level) return;
    const s = this.cell;
    const solidAt = (x: number, y: number): boolean => {
      const i = y * W + x;
      const k = this.level!.kinds[i];
      if (k === 'solid') return true;
      if (k === 'gate' && !this.gateState[i]) return true;
      return this.pieces.some((p) => p.x === x && p.y === y && p.type !== 'RAMP');
    };
    for (const p of this.pieces) {
      if (p.type !== 'FAN') continue;
      const [ddx, ddy] = p.dir === 'L' ? [-1, 0] : p.dir === 'R' ? [1, 0] : [0, -1];
      for (let d = 1; d <= 3; d++) {
        const x = p.x + ddx * d;
        const y = p.y + ddy * d;
        if (x < 0 || x >= W || y < 0 || y >= H || solidAt(x, y)) break;
        g.fillStyle(C.beam, 0.75 - d * 0.18);
        for (const k of [-0.22, 0.22]) {
          const bx = this.px(x) + (ddx === 0 ? k * s : 0);
          const by = this.py(y) + (ddx !== 0 ? k * s : 0);
          g.fillCircle(bx, by, Math.max(2, s * 0.06));
        }
      }
    }
  }

  private drawHighlights(): void {
    const g = this.hiG;
    if (!g) return;
    g.clear();
    for (const i of this.highlights) {
      const x = i % W;
      const y = Math.floor(i / W);
      g.translateCanvas(this.px(x), this.py(y));
      drawSocket(g, this.cell, true);
      g.translateCanvas(-this.px(x), -this.py(y));
    }
  }

  private drawGhost(): void {
    const g = this.ghostG;
    if (!g) return;
    g.clear();
    const s = this.cell;
    // Paths are soft dotted trails, not lines.
    const dots = (r: SimResult | undefined, color: number, alpha: number, radius: number): void => {
      if (!r) return;
      const seen = new Set<string>();
      for (const f of r.frames) {
        if (f.x < 0 || f.x >= W || f.y < 0 || f.y >= H) continue;
        const k = `${f.x},${f.y}`;
        if (seen.has(k)) continue;
        seen.add(k);
        g.fillStyle(color, alpha);
        g.fillCircle(this.px(f.x), this.py(f.y), radius);
      }
    };
    if (!this.ghost.now) {
      dots(this.ghost.old, C.pathNew, 0.8, Math.max(2.5, s * 0.085));
      return;
    }
    dots(this.ghost.old, C.pathOld, 0.9, Math.max(2, s * 0.07));
    dots(this.ghost.now, C.pathNew, 0.95, Math.max(3, s * 0.1));
  }

  // ---------- playback ----------

  override update(_time: number, delta: number): void {
    const spin = delta * 0.006;
    for (const b of this.blades) {
      const boost = this.bladeBoost.get(b.id) ?? 0;
      b.g.rotation += spin * (1 + boost * 4);
      if (boost > 0) this.bladeBoost.set(b.id, Math.max(0, boost - delta / 600));
    }
    const p = this.play;
    if (!p) return;
    const speed = p.opts.speed ?? 1;
    const slow = p.opts.slowmo?.(p.tick, p.run) ?? 1;
    p.t += delta * speed * slow;
    const target = Math.floor(p.t / TICK_MS);
    while (p.tick < target && p.tick < p.run.frames.length - 1) {
      p.tick++;
      for (const e of p.run.events) if (e.tick === p.tick) this.applyEvent(e, false);
    }
    const frames = p.run.frames;
    const last = frames.length - 1;
    if (p.tick >= last) {
      const f = frames[last]!;
      this.ball.setPosition(this.px(f.x), this.py(f.y));
      this.finish();
      return;
    }
    const a = frames[p.tick]!;
    const b = frames[p.tick + 1]!;
    const frac = Math.min(1, (p.t - p.tick * TICK_MS) / TICK_MS);
    const falling = b.y > a.y && a.x === b.x;
    const e = falling ? frac * frac * (2 - frac) * 0.5 + frac * 0.5 : 0.5 - Math.cos(frac * Math.PI) / 2;
    let x = this.px(a.x + (b.x - a.x) * e);
    let y = this.py(a.y + (b.y - a.y) * e);
    // Flights arc slightly for a smoother launch.
    const groundY = y;
    const flying = b.mode === 'fly' || a.mode === 'fly';
    if (flying) y -= Math.sin(frac * Math.PI) * this.cell * 0.12;
    // Lift eases in and out so the shadow drifts smoothly under a jumping ball.
    p.lift = (p.lift ?? 0) + ((flying ? 1 : 0) - (p.lift ?? 0)) * Math.min(1, delta / 90);
    if (a.x === b.x && a.y === b.y) {
      x = this.px(a.x);
      y = this.py(a.y);
    }
    this.ball.setPosition(x, y - (p.lift ?? 0) * this.cell * 0.18);
    this.placeShadow(x, groundY, p.lift ?? 0);
    // Squash on landing.
    if (a.mode === 'fall' && b.mode === 'roll' && frac < 0.4) this.ball.setScale(1 + (0.4 - frac) * 0.5, 1 - (0.4 - frac) * 0.5);
    else this.ball.setScale(1);
    // Trail.
    p.trail.push({ x, y });
    if (p.trail.length > 7) p.trail.shift();
    const tg = this.trailG;
    tg.clear();
    p.trail.forEach((pt, i) => {
      tg.fillStyle(C.pathNew, (i / p.trail.length) * 0.16);
      tg.fillCircle(pt.x, pt.y, this.cell * 0.22 * (i / p.trail.length));
    });
  }

  private applyEvent(e: SimEvent, silent: boolean): void {
    const L = this.level;
    if (!L) return;
    const [x, y] = e.cell;
    const i = y * W + x;
    if (e.kind === 'gate') {
      this.gateState[i] = e.n === 1;
      const g = this.dynamic.get(i);
      if (g) {
        g.clear();
        drawGate(g, this.cell, this.gateState[i]!);
        if (!silent) this.pop(g, 1.15);
      }
      this.drawBeams();
      this.drawShadows();
    } else if (e.kind === 'switch') {
      this.fired.add(i);
      const g = this.dynamic.get(i);
      if (g) {
        g.clear();
        drawSwitch(g, this.cell, true);
        if (!silent) this.pop(g, 1.3);
      }
    } else if (e.kind === 'checkpoint') {
      this.cpDone = Math.max(this.cpDone, e.n ?? 0);
      this.drawDynamicCells();
      if (!silent) this.ring(x, y, C.blue);
    }
    if (silent) return;
    this.play?.opts.onEvent?.(e);
    const obj = e.pieceId ? this.pieceObjs.get(e.pieceId) : undefined;
    const piece = e.pieceId ? this.pieces.find((q) => q.id === e.pieceId) : undefined;
    if (e.kind === 'launch' && obj) {
      this.tweens.add({ targets: obj, scaleY: { from: 0.55, to: 1 }, duration: 260, ease: 'Back.easeOut' });
    } else if (e.kind === 'deflect' && obj && piece?.type === 'BUMPER') {
      this.pop(obj, 1.25);
      this.flash(piece.x, piece.y, C.yellow);
    } else if (e.kind === 'deflect' && obj) {
      this.tweens.add({ targets: obj, angle: { from: -8, to: 0 }, duration: 220, ease: 'Sine.easeOut' });
    } else if (e.kind === 'touch' && piece?.type === 'FAN') {
      this.bladeBoost.set(piece.id, 1);
    }
    if (e.kind === 'touch' && piece && this.play?.opts.showOwners && piece.owner && !this.play.shownOwners.has(piece.id)) {
      this.play.shownOwners.add(piece.id);
      this.floatText(piece.x, piece.y, piece.setup ? 'setup' : `u/${piece.owner}`);
    }
  }

  private pop(target: Phaser.GameObjects.Components.Transform & Phaser.GameObjects.GameObject, k: number): void {
    this.tweens.add({ targets: target, scale: { from: k, to: 1 }, duration: 240, ease: 'Back.easeOut' });
  }

  private flash(x: number, y: number, color: number): void {
    const g = this.add.graphics({ x: this.px(x), y: this.py(y) });
    g.fillStyle(color, 0.7);
    g.fillCircle(0, 0, this.cell * 0.55);
    this.fx.add(g);
    this.tweens.add({ targets: g, alpha: 0, scale: 1.6, duration: 300, onComplete: () => g.destroy() });
  }

  private ring(x: number, y: number, color: number): void {
    const g = this.add.graphics({ x: this.px(x), y: this.py(y) });
    g.lineStyle(3, color, 1);
    g.strokeCircle(0, 0, this.cell * 0.4);
    this.fx.add(g);
    this.tweens.add({ targets: g, alpha: 0, scale: 2.4, duration: 520, ease: 'Cubic.easeOut', onComplete: () => g.destroy() });
  }

  floatText(x: number, y: number, text: string): void {
    const t = this.add
      .text(this.px(x), this.py(y) - this.cell * 0.6, text, {
        fontFamily: FONT,
        fontSize: `${Math.max(12, Math.round(this.cell * 0.36))}px`,
        color: '#ffffff',
        backgroundColor: '#2b2d3a',
        padding: { x: 6, y: 3 },
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 1)
      .setResolution(DPR)
      .setDepth(70);
    this.tweens.add({ targets: t, y: t.y - this.cell * 0.5, alpha: { from: 1, to: 0 }, delay: 700, duration: 700, onComplete: () => t.destroy() });
  }

  private finish(): void {
    this.tweens.add({ targets: this.ballShadow, alpha: 0, duration: 260 });
    const p = this.play;
    if (!p) return;
    this.play = null;
    this.trailG.clear();
    const f = p.run.frames[p.run.frames.length - 1]!;
    const end = p.run.end;
    const done = (): void => {
      const cam = this.cameras.main;
      cam.stopFollow();
      if (p.opts.follow) {
        // Ease back out to the whole board.
        cam.pan(this.scale.width / 2, this.scale.height / 2, 450, 'Sine.easeInOut');
        cam.zoomTo(1, 450, 'Sine.easeInOut');
      }
      p.resolve();
    };
    if (end === 'success') {
      this.confetti(f.x, f.y);
      this.tweens.add({ targets: this.ball, scale: 0, duration: 260, delay: 120, onComplete: done });
    } else if (end === 'lost') {
      this.puff(f.x, f.y);
      this.cameras.main.shake(180, 0.006);
      this.tweens.add({ targets: this.ball, alpha: 0, duration: 220, onComplete: done });
    } else if (end === 'stalled') {
      this.tweens.add({ targets: this.ball, angle: { from: -14, to: 14 }, duration: 90, yoyo: true, repeat: 3, onComplete: done });
    } else if (end === 'loop') {
      const t = this.add.text(this.px(f.x), this.py(f.y) - this.cell * 0.8, '↻', { fontFamily: FONT, fontSize: `${Math.round(this.cell * 0.8)}px`, color: '#2f6fdb' }).setOrigin(0.5).setDepth(70);
      this.tweens.add({ targets: t, angle: 360, duration: 700, repeat: 1, onComplete: () => { t.destroy(); done(); } });
    } else {
      done();
    }
  }

  private confetti(x: number, y: number): void {
    const colors = [C.yellow, C.orange, C.blue, C.red, C.green];
    if (this.targetKind === 'bell') {
      for (let k = 0; k < 3; k++) this.time.delayedCall(k * 140, () => this.ring(x, y, C.yellow));
    }
    for (let i = 0; i < 28; i++) {
      const g = this.add.graphics({ x: this.px(x), y: this.py(y) });
      g.fillStyle(colors[i % colors.length]!, 1);
      g.fillRect(-3, -2, 6, 4);
      this.fx.add(g);
      const a = (i / 28) * Math.PI * 2;
      const r = this.cell * (1.2 + (i % 5) * 0.35);
      this.tweens.add({
        targets: g,
        x: g.x + Math.cos(a) * r,
        y: g.y + Math.sin(a) * r - this.cell,
        angle: 360,
        alpha: 0,
        duration: 900 + (i % 4) * 120,
        ease: 'Cubic.easeOut',
        onComplete: () => g.destroy(),
      });
    }
  }

  private puff(x: number, y: number): void {
    const cx = this.px(Math.max(0, Math.min(W - 1, x)));
    const cy = this.py(Math.max(0, Math.min(H - 1, y)));
    for (let i = 0; i < 8; i++) {
      const g = this.add.graphics({ x: cx, y: cy });
      g.fillStyle(0xbcb3a3, 0.8);
      g.fillCircle(0, 0, this.cell * 0.18);
      this.fx.add(g);
      const a = (i / 8) * Math.PI * 2;
      this.tweens.add({ targets: g, x: cx + Math.cos(a) * this.cell * 0.7, y: cy + Math.sin(a) * this.cell * 0.7, alpha: 0, scale: 1.8, duration: 420, onComplete: () => g.destroy() });
    }
  }

  /** Human-readable cell name, for UI. */
  static cellLabel(x: number, y: number): string {
    return cellName(x, y);
  }
}
