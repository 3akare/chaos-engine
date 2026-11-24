/**
 * Procedural 2.5D drawing. Every solid thing is an extruded block: a top face lifted by
 * `depth(s)` with a darker front face below it, lit from the top-left. Shadows are drawn
 * separately (see BoardScene's shadow layer). Everything is centred on (0,0), cell size `s`.
 */
import type * as Phaser from 'phaser';
import type { Dir, PieceType } from '../../../shared/types';
import { C } from '../theme';

type G = Phaser.GameObjects.Graphics;
type Corners = { tl: number; tr: number; bl: number; br: number };

export const depth = (s: number): number => Math.max(3, Math.round(s * 0.16));

const ANG: Record<string, number> = { R: 0, L: Math.PI, U: -Math.PI / 2, UR: -Math.PI / 4, UL: (-3 * Math.PI) / 4, DR: Math.PI / 4, DL: (3 * Math.PI) / 4 };
export const dirAngle = (d: Dir): number => ANG[d] ?? 0;

/** A chunky arrow, used on piece tops to show direction. */
export function arrow(g: G, s: number, angle: number, color: number, cx = 0, cy = 0, scale = 1): void {
  const L = s * 0.24 * scale;
  const w = s * 0.17 * scale;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const p = (a: number, b: number) => ({ x: cx + cos * a - sin * b, y: cy + sin * a + cos * b });
  const tip = p(L, 0);
  const l = p(L * 0.05, -w);
  const r = p(L * 0.05, w);
  g.fillStyle(color, 1);
  g.fillTriangle(tip.x, tip.y, l.x, l.y, r.x, r.y);
  const t1 = p(-L, -w * 0.32);
  const t2 = p(L * 0.1, -w * 0.32);
  const t3 = p(L * 0.1, w * 0.32);
  const t4 = p(-L, w * 0.32);
  g.fillTriangle(t1.x, t1.y, t2.x, t2.y, t3.x, t3.y);
  g.fillTriangle(t1.x, t1.y, t3.x, t3.y, t4.x, t4.y);
}

/** A raised rounded box filling (part of) the cell. */
export function box(g: G, s: number, top: number, side: number, inset: number, r: number | Corners, lift = depth(s), alpha = 1): void {
  const h = s / 2;
  const x0 = -h + inset;
  const w = s - inset * 2;
  g.fillStyle(side, alpha);
  g.fillRoundedRect(x0, -h + inset, w, w, r);
  g.fillStyle(top, alpha);
  g.fillRoundedRect(x0, -h + inset - lift, w, w, r);
}

/** Wall cell: merges with solid neighbours so ledges read as one slab. */
export function drawWall(g: G, s: number, n: { up: boolean; down: boolean; left: boolean; right: boolean }): void {
  const h = s / 2;
  const d = depth(s);
  const r = Math.round(s * 0.24);
  const corners: Corners = {
    tl: n.up || n.left ? 0 : r,
    tr: n.up || n.right ? 0 : r,
    bl: n.down || n.left ? 0 : r,
    br: n.down || n.right ? 0 : r,
  };
  const x0 = n.left ? -h : -h + 1;
  const x1 = n.right ? h : h - 1;
  if (!n.down) {
    g.fillStyle(C.wallSide, 1);
    g.fillRoundedRect(x0, -h, x1 - x0, s, corners);
  }
  g.fillStyle(C.wallTop, 1);
  g.fillRoundedRect(x0, -h - d, x1 - x0, n.down ? s + d : s, corners);
}

/** Shadow footprint for a solid cell (drawn into the shared shadow layer). */
export function shadowRect(g: G, s: number, sx: number, sy: number): void {
  const h = s / 2;
  g.fillRect(-h + sx, -h + sy, s, s);
}

export function drawSocket(g: G, s: number, highlight = false): void {
  // A soft dimple. Highlighted dimples swell and take the accent colour; never an outline.
  if (highlight) {
    g.fillStyle(C.pathNew, 0.28);
    g.fillCircle(0, 0, s * 0.36);
    g.fillStyle(C.pathNew, 0.9);
    g.fillCircle(0, 0, s * 0.2);
    return;
  }
  g.fillStyle(C.socket, 0.85);
  g.fillCircle(0, 0, s * 0.19);
  g.fillStyle(0x000000, 0.05);
  g.fillCircle(0, -s * 0.03, s * 0.15);
}

export function drawStart(g: G, s: number, _dx: number): void {
  // The chute: a small block with a hole in its top.
  const d = depth(s) * 0.7;
  g.fillStyle(C.wallSide, 1);
  g.fillRoundedRect(-s * 0.3, -s * 0.38, s * 0.6, s * 0.5, s * 0.16);
  g.fillStyle(C.wallTop, 1);
  g.fillRoundedRect(-s * 0.3, -s * 0.38 - d, s * 0.6, s * 0.5, s * 0.16);
  g.fillStyle(C.socket, 1);
  g.fillEllipse(0, -s * 0.15 - d, s * 0.3, s * 0.18);
}

export function drawTarget(g: G, s: number, _kind: 'bell' | 'basket'): void {
  const d = depth(s) * 0.6;
  g.fillStyle(C.fanSide, 1);
  g.fillEllipse(0, s * 0.08 + d, s * 0.82, s * 0.5);
  g.fillStyle(C.fan, 1);
  g.fillEllipse(0, s * 0.08, s * 0.82, s * 0.5);
  g.fillStyle(0xffffff, 0.55);
  g.fillEllipse(0, s * 0.08, s * 0.46, s * 0.24);
  g.fillStyle(C.fan, 1);
  g.fillEllipse(0, s * 0.1, s * 0.26, s * 0.12);
}

export function drawCheckpoint(g: G, s: number, done: boolean): void {
  g.fillStyle(done ? C.blue : C.socket, done ? 1 : 0.85);
  g.fillCircle(0, 0, s * 0.3);
}

export function drawSwitch(g: G, s: number, fired: boolean): void {
  // A round floor button: raised until the ball presses it.
  g.fillStyle(C.socket, 0.85);
  g.fillCircle(0, 0, s * 0.3);
  const lift = fired ? 0 : depth(s) * 0.5;
  g.fillStyle(fired ? C.fanSide : C.springSide, 1);
  g.fillCircle(0, 0, s * 0.19);
  g.fillStyle(fired ? C.fan : C.spring, 1);
  g.fillCircle(0, -lift, s * 0.19);
}

export function drawGate(g: G, s: number, open: boolean): void {
  if (open) {
    g.fillStyle(C.gate, 0.22);
    g.fillRoundedRect(-s * 0.42, -s * 0.42, s * 0.84, s * 0.84, s * 0.22);
    return;
  }
  box(g, s, C.gate, C.gateSide, s * 0.06, s * 0.22);
}

export function drawPiece(g: G, type: PieceType, dir: Dir, s: number, alpha = 1): void {
  const h = s / 2;
  const d = depth(s);
  switch (type) {
    case 'RAMP': {
      // Same block as every other piece; the arrow says which way it sends the ball.
      box(g, s, C.ramp, C.rampSide, s * 0.06, s * 0.22, d, alpha);
      arrow(g, s, dirAngle(dir), 0xffffff, 0, -d, 0.95);
      break;
    }
    case 'SPRING': {
      box(g, s, C.spring, C.springSide, s * 0.06, s * 0.22, d, alpha);
      arrow(g, s, dirAngle(dir), 0xffffff, 0, -d, 0.95);
      break;
    }
    case 'FAN': {
      box(g, s, C.fan, C.fanSide, s * 0.06, s * 0.22, d, alpha);
      g.fillStyle(0x000000, 0.18 * alpha);
      g.fillCircle(0, -d, h * 0.62);
      const a = dirAngle(dir);
      arrow(g, s, a, 0xffffff, Math.cos(a) * h * 0.66, Math.sin(a) * h * 0.66 - d, 0.55);
      break;
    }
    case 'BUMPER': {
      g.fillStyle(C.bumperSide, alpha);
      g.fillEllipse(0, 0, s * 0.82, s * 0.82);
      g.fillRect(-s * 0.41, -d, s * 0.82, d);
      g.fillStyle(C.bumper, alpha);
      g.fillEllipse(0, -d, s * 0.82, s * 0.82);
      g.fillStyle(0xffffff, 0.35 * alpha);
      g.fillEllipse(-h * 0.25, -h * 0.3 - d, s * 0.22, s * 0.14);
      arrow(g, s, dirAngle(dir), 0xffffff, 0, -d, 0.95);
      break;
    }
  }
}

export function drawFanBlades(g: G, s: number, _dir: Dir, alpha = 1): void {
  const h = s / 2;
  g.fillStyle(0xffffff, 0.9 * alpha);
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI * 2) / 3;
    g.fillEllipse(Math.cos(a) * h * 0.26, Math.sin(a) * h * 0.26, h * 0.5, h * 0.22);
  }
  g.fillStyle(C.fanSide, alpha);
  g.fillCircle(0, 0, h * 0.12);
}

/** Footprint of a piece's shadow (relative to its cell centre). */
export function pieceShadow(g: G, type: PieceType, dir: Dir, s: number, sx: number, sy: number): void {
  const h = s / 2;
  if (type === 'BUMPER') {
    g.fillEllipse(sx, sy, s * 0.82, s * 0.82);
  } else if (type === 'RAMP') {
    const k = dir === 'DR' ? 1 : -1;
    g.fillTriangle(-k * h * 0.8 + sx, -h * 0.5 + sy, k * h * 0.8 + sx, h * 0.6 + sy, k * h * 0.6 + sx, h * 0.6 + sy);
  } else {
    g.fillRoundedRect(-h * 0.88 + sx, -h * 0.88 + sy, s * 0.88, s * 0.88, s * 0.18);
  }
}

/** Textures for the ball and its soft shadow, generated once per cell size. */
export function makeBallTextures(scene: Phaser.Scene, s: number): void {
  const r = Math.round(s * 0.32);
  for (const key of ['ce-ball', 'ce-ballshadow']) if (scene.textures.exists(key)) scene.textures.remove(key);
  const size = r * 2 + 4;
  const bt = scene.textures.createCanvas('ce-ball', size, size)!;
  const c = bt.getContext();
  const cx = size / 2;
  const grad = c.createRadialGradient(cx - r * 0.35, cx - r * 0.4, r * 0.1, cx, cx, r);
  const base = `#${C.ball.toString(16).padStart(6, '0')}`;
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.25, base);
  grad.addColorStop(1, shade(C.ball, -0.45));
  c.fillStyle = grad;
  c.beginPath();
  c.arc(cx, cx, r, 0, Math.PI * 2);
  c.fill();
  bt.refresh();
  const sw = r * 3;
  const st = scene.textures.createCanvas('ce-ballshadow', sw, sw)!;
  const sc = st.getContext();
  const sg = sc.createRadialGradient(sw / 2, sw / 2, 0, sw / 2, sw / 2, sw / 2);
  sg.addColorStop(0, 'rgba(0,0,0,0.55)');
  sg.addColorStop(0.55, 'rgba(0,0,0,0.25)');
  sg.addColorStop(1, 'rgba(0,0,0,0)');
  sc.fillStyle = sg;
  sc.fillRect(0, 0, sw, sw);
  st.refresh();
}

function shade(color: number, k: number): string {
  const r = (color >> 16) & 255;
  const g = (color >> 8) & 255;
  const b = color & 255;
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k)));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
