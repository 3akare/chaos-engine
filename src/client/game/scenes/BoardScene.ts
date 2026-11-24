/**
 * The board, drawn entirely with sprites (Kenney's New Platformer Pack): grass blocks, a red ball,
 * springs, ramps, fans, a goal flag. Takes taps, shows the predicted path, plays runs.
 * Buttons and cards live in the DOM; this scene only knows about the board.
 */
import * as Phaser from 'phaser';
import { cellName } from '../../../shared/coords';
import type { Level } from '../../../shared/sim/level';
import { H, W, type BoardPiece, type SimEvent, type SimResult } from '../../../shared/types';
import { pieceLook, SPRITES } from '../../assets';

export type ScenePiece = BoardPiece & { owner?: string; mine?: boolean; setup?: boolean; ghost?: boolean };

export type PlayOptions = {
  speed?: number;
  /** Extra slow-down factor for a tick (1 = normal, 0.35 = slow motion). */
  slowmo?: (tick: number, run: SimResult) => number;
  onEvent?: (e: SimEvent) => void;
  /** Float the owner's name over a piece the first time the ball touches it. */
  showOwners?: boolean;
  /** Kept for callers; the whole board always stays in view. */
  follow?: boolean;
  startTick?: number;
  /** Ball sprite (each surprise ball has its own colour). */
  ball?: string;
};

type Playback = {
  run: SimResult;
  t: number;
  tick: number;
  opts: PlayOptions;
  resolve: () => void;
  shownOwners: Set<string>;
};

export const TICK_MS = 110;
export const FONT = '"Lilita One", system-ui, sans-serif';
const INK = 0x353541;
/** The game canvas is rendered at the screen's real pixel density (see main.ts); CSS px × PX = game px. */
export const PX = Math.min(3, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);

const D = { spot: 1, wall: 2, thing: 3, path: 4, piece: 5, mark: 6, ball: 10, fx: 20, text: 30 };

export class BoardScene extends Phaser.Scene {
  private level: Level | null = null;
  private pieces: ScenePiece[] = [];
  private cell = 40;
  private ox = 0;
  private oy = 0;
  showLabels = false;

  private staticObjs: Phaser.GameObjects.GameObject[] = [];
  private pieceObjs = new Map<string, Phaser.GameObjects.Image>();
  private pieceExtras: Phaser.GameObjects.GameObject[] = [];
  private blades: Array<{ id: string; img: Phaser.GameObjects.Image; boost: number }> = [];
  private windT = 0;
  private cellObjs = new Map<number, Phaser.GameObjects.Image>();
  private cpTexts = new Map<number, Phaser.GameObjects.Text>();
  private hiObjs: Phaser.GameObjects.Image[] = [];
  private pathG!: Phaser.GameObjects.Graphics;
  private beamG!: Phaser.GameObjects.Graphics;
  private ball!: Phaser.GameObjects.Image;
  private restBall!: Phaser.GameObjects.Image;
  private flag: Phaser.GameObjects.Image | null = null;
  private play: Playback | null = null;
  private ghost: { old?: SimResult | undefined; now?: SimResult | undefined } = {};
  private highlights: Array<[number, number]> = [];
  private gateState: boolean[] = [];
  private fired = new Set<number>();
  private cpDone = 0;

  onTap: ((x: number, y: number) => void) | null = null;
  onReady: (() => void) | null = null;

  constructor() {
    super('board');
  }

  preload(): void {
    for (const [k, url] of Object.entries(SPRITES)) this.load.image(k, url);
  }

  create(): void {
    this.cameras.main.setBackgroundColor('rgba(0,0,0,0)');
    for (const k of Object.keys(SPRITES)) this.textures.get(k).setFilter(Phaser.Textures.FilterMode.LINEAR);
    this.pathG = this.add.graphics().setDepth(D.path);
    this.beamG = this.add.graphics().setDepth(D.path);
    this.ball = this.add.image(0, 0, 'ball').setDepth(D.ball).setVisible(false);
    this.restBall = this.add.image(0, 0, 'ball').setDepth(D.ball).setVisible(false);
    this.time.addEvent({ delay: 380, loop: true, callback: () => this.flag?.setTexture(this.flag.texture.key === 'flag_a' ? 'flag_b' : 'flag_a') });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (p.getDistance() > 12 * PX) return;
      const x = Math.floor((p.worldX - this.ox) / this.cell);
      const y = Math.floor((p.worldY - this.oy) / this.cell);
      if (x >= 0 && x < W && y >= 0 && y < H) this.onTap?.(x, y);
    });
    this.scale.on('resize', () => this.layout());
    this.layout();
    this.onReady?.();
  }

  // ---------- public API ----------

  setBoard(level: Level, pieces: ScenePiece[], _target: 'bell' | 'basket' = 'bell'): void {
    const changed = level !== this.level;
    this.level = level;
    this.pieces = pieces;
    if (changed) this.resetDynamic(false);
    this.redraw();
  }

  setPieces(pieces: ScenePiece[]): void {
    this.pieces = pieces;
    this.drawPieces();
    this.drawSpots();
    this.drawBeams();
  }

  setHighlights(cells: Array<[number, number]>): void {
    this.highlights = cells;
    this.drawHighlights();
  }

  setGhost(old: SimResult | undefined, now: SimResult | undefined): void {
    this.ghost = { old, now };
    this.drawPath();
  }

  cellCenter(x: number, y: number): { x: number; y: number } {
    return { x: this.px(x), y: this.py(y) };
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
    this.resetDynamic(true);
    this.restBall.setVisible(true);
    p.resolve();
  }

  playRun(run: SimResult, opts: PlayOptions = {}): Promise<void> {
    this.stop();
    this.resetDynamic(true);
    return new Promise((resolve) => {
      const start = opts.startTick ?? 0;
      this.play = { run, t: start * TICK_MS, tick: start, opts, resolve, shownOwners: new Set() };
      for (const e of run.events) if (e.tick <= start) this.applyEvent(e, true);
      const f = run.frames[start]!;
      this.ball.setTexture(opts.ball ?? 'ball').setPosition(this.px(f.x), this.py(f.y)).setScale(this.ballScale()).setAlpha(1).setAngle(0).setVisible(true);
      this.restBall.setVisible(false);
    });
  }

  floatText(x: number, y: number, text: string): void {
    const t = this.add
      .text(this.px(x), this.py(y) - this.cell * 0.55, text, {
        fontFamily: FONT,
        fontSize: `${Math.max(12 * PX, Math.round(this.cell * 0.34))}px`,
        color: '#ffffff',
        stroke: '#353541',
        strokeThickness: 6 * PX,
      })
      .setOrigin(0.5, 1)
      
      .setDepth(D.text);
    this.tweens.add({ targets: t, y: t.y - this.cell * 0.5, alpha: { from: 1, to: 0 }, delay: 700, duration: 700, onComplete: () => t.destroy() });
  }

  /** Cell name for tools (sandbox). */
  static cellLabel(x: number, y: number): string {
    return cellName(x, y);
  }

  // ---------- layout ----------

  private layout(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    const gut = this.showLabels ? 18 * PX : 0;
    this.cell = Math.max(16 * PX, Math.min(Math.floor((w - 12 * PX - gut) / W), Math.floor((h - 12 * PX - gut) / H), 80 * PX));
    this.ox = Math.round((w - this.cell * W + gut) / 2);
    this.oy = Math.round((h - this.cell * H + gut) / 2);
    this.redraw();
  }

  private px(x: number): number {
    return this.ox + (x + 0.5) * this.cell;
  }
  private py(y: number): number {
    return this.oy + (y + 0.5) * this.cell;
  }
  private ballScale(): number {
    return (this.cell * 0.78) / 128;
  }

  private img(key: string, x: number, y: number, size: number, depth: number): Phaser.GameObjects.Image {
    const i = this.add.image(this.px(x), this.py(y), key).setDepth(depth);
    i.setDisplaySize(size, size);
    return i;
  }

  // ---------- drawing ----------

  private redraw(): void {
    if (!this.pathG) return;
    this.drawStatic();
    this.drawPieces();
    this.drawSpots();
    this.drawBeams();
    this.drawHighlights();
    this.drawPath();
  }

  private drawStatic(): void {
    for (const o of this.staticObjs) o.destroy();
    this.staticObjs = [];
    for (const o of this.cellObjs.values()) o.destroy();
    this.cellObjs.clear();
    for (const t of this.cpTexts.values()) t.destroy();
    this.cpTexts.clear();
    this.flag = null;
    const L = this.level;
    const s = this.cell;
    if (this.showLabels) {
      const style = { fontFamily: FONT, fontSize: `${Math.round(s * 0.3)}px`, color: '#353541' };
      for (let x = 0; x < W; x++) this.staticObjs.push(this.add.text(this.px(x), this.oy - 10 * PX, 'ABCDEFGHI'[x]!, style).setOrigin(0.5));
      for (let y = 0; y < H; y++) this.staticObjs.push(this.add.text(this.ox - 10 * PX, this.py(y), String(y + 1), style).setOrigin(0.5));
    }
    if (!L) return;
    const solid = (x: number, y: number): boolean => x >= 0 && x < W && y >= 0 && y < H && L.kinds[y * W + x] === 'solid';
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const k = L.kinds[i];
        if (k === 'solid') {
          const o = this.img(`wall_${wallTile(solid(x, y - 1), solid(x, y + 1), solid(x - 1, y), solid(x + 1, y))}`, x, y, s + 2 * PX, D.wall);
          this.staticObjs.push(o);
        } else if (k === 'target') {
          this.flag = this.img('flag_a', x, y, s * 1.05, D.thing);
          this.flag.y -= s * 0.04;
          this.staticObjs.push(this.flag);
        } else if (k === 'switch') {
          this.cellObjs.set(i, this.img(this.fired.has(i) ? 'switch_on' : 'switch', x, y, s, D.thing));
        } else if (k === 'gate') {
          const g = this.img('lock', x, y, s, D.thing);
          g.setAlpha(this.gateState[i] ? 0.22 : 1);
          this.cellObjs.set(i, g);
        } else if (k === 'checkpoint') {
          const n = L.cp[i]!;
          const c = this.img('coin', x, y, s * 1.45, D.thing).setAlpha(n <= this.cpDone ? 0.3 : 1);
          this.cellObjs.set(i, c);
          const t = this.add
            .text(this.px(x), this.py(y), String(n), { fontFamily: FONT, fontSize: `${Math.round(s * 0.36)}px`, color: '#ffffff', stroke: '#353541', strokeThickness: 4 * PX })
            .setOrigin(0.5)
            
            .setDepth(D.mark)
            .setAlpha(n <= this.cpDone ? 0.3 : 1);
          this.cpTexts.set(i, t);
        }
      }
    }
    const st = L.start;
    this.restBall.setPosition(this.px(st.x), this.py(st.y)).setScale(this.ballScale()).setVisible(!this.play);
  }

  /** Empty build spots: a soft white tile with a plus. Hidden under pieces. */
  private spotObjs: Phaser.GameObjects.Image[] = [];
  private drawSpots(): void {
    for (const o of this.spotObjs) o.destroy();
    this.spotObjs = [];
    const L = this.level;
    if (!L) return;
    const taken = new Set(this.pieces.map((p) => p.y * W + p.x));
    for (let i = 0; i < W * H; i++) {
      if (!L.socket[i] || taken.has(i)) continue;
      this.spotObjs.push(this.img('spot', i % W, Math.floor(i / W), this.cell * 0.8, D.spot).setAlpha(0.85));
    }
  }

  private drawPieces(): void {
    for (const o of this.pieceObjs.values()) o.destroy();
    this.pieceObjs.clear();
    for (const o of this.pieceExtras) o.destroy();
    this.pieceExtras = [];
    this.blades = [];
    const s = this.cell;
    for (const p of this.pieces) {
      const look = pieceLook(p.type, p.dir);
      const depth = p.ghost ? D.piece + 1 : D.piece;
      const o = this.img(p.type === 'FAN' ? 'fan' : look.key, p.x, p.y, s, depth);
      if (p.type !== 'FAN') o.setAngle(look.angle).setFlipX(look.flip);
      const pulse: Phaser.GameObjects.Image[] = [o];
      if (p.type === 'FAN') {
        // The ring's centre sits 6/128 above the tile centre.
        const bl = this.add.image(this.px(p.x), this.py(p.y) - s * (6 / 128), 'fan_blades').setDepth(depth);
        bl.setDisplaySize(s, s);
        this.pieceExtras.push(bl);
        this.blades.push({ id: p.id, img: bl, boost: 0 });
        pulse.push(bl);
      }
      if (p.ghost) this.tweens.add({ targets: pulse, alpha: { from: 0.55, to: 1 }, duration: 550, yoyo: true, repeat: -1 });
      this.pieceObjs.set(p.id, o);
      if (p.mine && !p.ghost) {
        const star = this.add.image(this.px(p.x) + s * 0.36, this.py(p.y) - s * 0.36, 'star').setDepth(D.mark);
        star.setDisplaySize(s * 0.42, s * 0.42);
        this.pieceExtras.push(star);
      }
    }
  }

  /** Wind streaks moving out of each fan, up to three cells. */
  private drawBeams(): void {
    const g = this.beamG;
    if (!g) return;
    g.clear();
    const phase = (this.windT % 700) / 700;
    const L = this.level;
    if (!L) return;
    const s = this.cell;
    const blocked = (x: number, y: number): boolean => {
      const i = y * W + x;
      const k = L.kinds[i];
      if (k === 'solid' || (k === 'gate' && !this.gateState[i])) return true;
      return this.pieces.some((p) => p.x === x && p.y === y && p.type !== 'RAMP');
    };
    for (const p of this.pieces) {
      if (p.type !== 'FAN') continue;
      const [dx, dy] = p.dir === 'L' ? [-1, 0] : p.dir === 'R' ? [1, 0] : [0, -1];
      let reach = 0;
      for (let d = 1; d <= 3; d++) {
        const x = p.x + dx * d;
        const y = p.y + dy * d;
        if (x < 0 || x >= W || y < 0 || y >= H || blocked(x, y)) break;
        reach = d;
      }
      // Three lanes of streaks flowing outward; they fade as they travel.
      for (let lane = -1; lane <= 1; lane++) {
        for (let k = 0; k < reach; k++) {
          const t = k + ((phase + (lane + 1) * 0.33) % 1);
          if (t > reach) continue;
          const along = 0.45 + t;
          const cx = this.px(p.x) + dx * along * s + (dx === 0 ? lane * 0.24 * s : 0);
          const cy = this.py(p.y) + dy * along * s + (dy === 0 ? lane * 0.22 * s : 0);
          const a = Math.max(0, 0.95 - (t / Math.max(1, reach)) * 0.8);
          const len = s * 0.3;
          const th = Math.max(2 * PX, s * 0.08);
          const w2 = dx ? len : th;
          const h2 = dx ? th : len;
          g.fillStyle(INK, a * 0.6);
          g.fillRoundedRect(cx - w2 / 2 - PX, cy - h2 / 2 - PX, w2 + 2 * PX, h2 + 2 * PX, th / 2 + PX);
          g.fillStyle(0xffffff, a);
          g.fillRoundedRect(cx - w2 / 2, cy - h2 / 2, w2, h2, th / 2);
        }
      }
    }
  }

  private drawHighlights(): void {
    for (const o of this.hiObjs) o.destroy();
    this.hiObjs = [];
    for (const [x, y] of this.highlights) {
      const o = this.img('spot', x, y, this.cell * 0.8, D.mark).setTint(0xffd34d);
      this.tweens.add({ targets: o, scale: { from: o.scale, to: o.scale * 1.15 }, duration: 420, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      this.hiObjs.push(o);
    }
  }

  /** Where the ball will go: a trail of outlined dots. Yellow = with your change. */
  private drawPath(): void {
    const g = this.pathG;
    if (!g) return;
    g.clear();
    const s = this.cell;
    const dots = (r: SimResult | undefined, fill: number, alpha: number, rad: number): void => {
      if (!r) return;
      const seen = new Set<string>();
      for (const f of r.frames) {
        if (f.x < 0 || f.x >= W || f.y < 0 || f.y >= H) continue;
        const k = `${f.x},${f.y}`;
        if (seen.has(k)) continue;
        seen.add(k);
        g.fillStyle(INK, alpha);
        g.fillCircle(this.px(f.x), this.py(f.y), rad + Math.max(1.5 * PX, s * 0.035));
        g.fillStyle(fill, alpha);
        g.fillCircle(this.px(f.x), this.py(f.y), rad);
      }
    };
    if (!this.ghost.now) {
      dots(this.ghost.old, 0xffffff, 1, Math.max(3 * PX, s * 0.09));
      return;
    }
    dots(this.ghost.old, 0xffffff, 0.55, Math.max(2.5 * PX, s * 0.07));
    dots(this.ghost.now, 0xffc851, 1, Math.max(3 * PX, s * 0.1));
  }

  // ---------- run playback ----------

  private resetDynamic(redraw: boolean): void {
    if (!this.level) return;
    this.gateState = this.level.gateOpen.slice();
    this.fired = new Set();
    this.cpDone = 0;
    if (redraw && this.pathG) {
      for (const [i, o] of this.cellObjs) {
        const k = this.level.kinds[i];
        if (k === 'switch') o.setTexture('switch');
        if (k === 'gate') o.setAlpha(this.gateState[i] ? 0.22 : 1);
        if (k === 'checkpoint') o.setAlpha(1);
      }
      for (const t of this.cpTexts.values()) t.setAlpha(1);
      for (const p of this.pieces) {
        const o = this.pieceObjs.get(p.id);
        if (o && !p.ghost) o.setTexture(pieceLook(p.type, p.dir).key).setAlpha(1);
      }
      this.drawBeams();
    }
  }

  override update(_time: number, delta: number): void {
    this.windT += delta;
    for (const b of this.blades) {
      b.img.rotation += delta * 0.008 * (1 + b.boost * 3);
      if (b.boost > 0) b.boost = Math.max(0, b.boost - delta / 800);
    }
    if (this.blades.length) this.drawBeams();
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
    if (b.mode === 'fly' || a.mode === 'fly') y -= Math.sin(frac * Math.PI) * this.cell * 0.14;
    if (a.x === b.x && a.y === b.y) {
      x = this.px(a.x);
      y = this.py(a.y);
    }
    // Roll: spin with horizontal travel.
    this.ball.angle += ((x - this.ball.x) / (this.cell * 0.39)) * (180 / Math.PI);
    this.ball.setPosition(x, y);
    const k = this.ballScale();
    if (a.mode === 'fall' && b.mode === 'roll' && frac < 0.4) this.ball.setScale(k * (1 + (0.4 - frac) * 0.45), k * (1 - (0.4 - frac) * 0.45));
    else this.ball.setScale(k);
  }

  private applyEvent(e: SimEvent, silent: boolean): void {
    const L = this.level;
    if (!L) return;
    const [x, y] = e.cell;
    const i = y * W + x;
    const o = this.cellObjs.get(i);
    if (e.kind === 'gate') {
      this.gateState[i] = e.n === 1;
      if (o) {
        if (silent) o.setAlpha(this.gateState[i] ? 0.22 : 1);
        else this.tweens.add({ targets: o, alpha: this.gateState[i] ? 0.22 : 1, duration: 260 });
      }
      this.drawBeams();
    } else if (e.kind === 'switch') {
      this.fired.add(i);
      o?.setTexture('switch_on');
      if (o && !silent) this.pop(o, 1.2);
    } else if (e.kind === 'checkpoint') {
      this.cpDone = Math.max(this.cpDone, e.n ?? 0);
      if (o) {
        if (!silent) this.pop(o, 1.4);
        this.tweens.add({ targets: [o, this.cpTexts.get(i)], alpha: 0.3, duration: silent ? 0 : 400, delay: silent ? 0 : 200 });
      }
      if (!silent) this.burst(x, y, 6);
    }
    if (silent) return;
    this.play?.opts.onEvent?.(e);
    const obj = e.pieceId ? this.pieceObjs.get(e.pieceId) : undefined;
    const piece = e.pieceId ? this.pieces.find((q) => q.id === e.pieceId) : undefined;
    if (obj && piece) {
      if (e.kind === 'launch' && piece.type === 'SPRING') this.squash(obj, 'spring', 'spring_out');
      else if (e.kind === 'deflect' && piece.type === 'BUMPER') this.squash(obj, 'bumper', 'bumper_out');
      else if (e.kind === 'deflect') this.tweens.add({ targets: obj, angle: { from: obj.angle - 8, to: obj.angle }, duration: 200, ease: 'Sine.easeOut' });
      else if (e.kind === 'touch' && piece.type === 'FAN') {
        const b = this.blades.find((q) => q.id === piece.id);
        if (b) b.boost = 1;
      }
    }
    if (e.kind === 'touch' && piece && this.play?.opts.showOwners && piece.owner && !piece.setup && !this.play.shownOwners.has(piece.id)) {
      this.play.shownOwners.add(piece.id);
      this.floatText(piece.x, piece.y, `u/${piece.owner}`);
    }
  }

  private squash(o: Phaser.GameObjects.Image, down: string, up: string): void {
    o.setTexture(down);
    this.time.delayedCall(120, () => o.active && o.setTexture(up));
  }

  private pop(target: Phaser.GameObjects.Image, k: number): void {
    const base = target.scale;
    this.tweens.add({ targets: target, scale: { from: base * k, to: base }, duration: 240, ease: 'Back.easeOut' });
  }

  private burst(x: number, y: number, n: number): void {
    for (let i = 0; i < n; i++) {
      const st = this.add.image(this.px(x), this.py(y), 'star').setDepth(D.fx);
      st.setDisplaySize(this.cell * 0.4, this.cell * 0.4);
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      const r = this.cell * (1 + (i % 3) * 0.4);
      this.tweens.add({ targets: st, x: st.x + Math.cos(a) * r, y: st.y + Math.sin(a) * r, angle: 200, alpha: 0, duration: 700, ease: 'Cubic.easeOut', onComplete: () => st.destroy() });
    }
  }

  private finish(): void {
    const p = this.play;
    if (!p) return;
    this.play = null;
    const f = p.run.frames[p.run.frames.length - 1]!;
    const done = (): void => {
      this.ball.setVisible(false);
      this.restBall.setVisible(true);
      p.resolve();
    };
    const k = this.ballScale();
    switch (p.run.end) {
      case 'success':
        this.burst(f.x, f.y, 12);
        if (this.flag) this.pop(this.flag, 1.3);
        this.tweens.add({ targets: this.ball, scale: 0, duration: 260, delay: 150, onComplete: done });
        break;
      case 'lost':
        this.cameras.main.shake(160, 0.005);
        this.tweens.add({ targets: this.ball, alpha: 0, scale: k * 0.6, duration: 260, onComplete: done });
        break;
      case 'stalled':
        this.tweens.add({ targets: this.ball, angle: { from: -16, to: 16 }, duration: 90, yoyo: true, repeat: 3, onComplete: done });
        break;
      case 'loop':
        this.tweens.add({ targets: this.ball, angle: '+=720', duration: 800, onComplete: done });
        break;
      default:
        done();
    }
  }
}

/** Pick the grass-terrain tile that matches a wall cell's neighbours. */
function wallTile(up: boolean, down: boolean, left: boolean, right: boolean): string {
  if (!up && !down) {
    if (left && right) return 'horizontal_middle';
    if (right) return 'horizontal_left';
    if (left) return 'horizontal_right';
    return 'block';
  }
  if (!left && !right) {
    if (up && down) return 'vertical_middle';
    return down ? 'vertical_top' : 'vertical_bottom';
  }
  const row = !up ? 'top' : !down ? 'bottom' : '';
  const side = !left ? 'left' : !right ? 'right' : '';
  if (row && side) return `block_${row}_${side}`;
  if (row) return `block_${row}`;
  if (side) return `block_${side}`;
  return 'block_center';
}
