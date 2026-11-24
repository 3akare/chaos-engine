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
  const r = Math.round(s * 0.16);
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
  // A soft highlight along exposed top edges (continuous across merged cells).
  if (!n.up) {
    const hx0 = n.left ? -h : x0 + 2;
    const hx1 = n.right ? h : x1 - 2;
    g.fillStyle(0xffffff, 0.16);
    g.fillRect(hx0, -h - d + 2, hx1 - hx0, Math.max(2, s * 0.08));
  }
}

/** Shadow footprint for a solid cell (drawn into the shared shadow layer). */
export function shadowRect(g: G, s: number, sx: number, sy: number): void {
  const h = s / 2;
  g.fillRect(-h + sx, -h + sy, s, s);
}

export function drawSocket(g: G, s: number, highlight = false): void {
  const h = s * 0.4;
  const r = s * 0.14;
  if (highlight) {
    g.fillStyle(C.blue, 0.22);
    g.fillRoundedRect(-h, -h, h * 2, h * 2, r);
  } else {
    g.fillStyle(C.socket, 0.6);
    g.fillRoundedRect(-h, -h, h * 2, h * 2, r);
  }
  // Dashed outline: an empty slot, not a block.
  g.lineStyle(Math.max(1.5, s * 0.05), highlight ? C.blue : C.socketEdge, highlight ? 1 : 0.7);
  const dash = s * 0.13;
  const gap = s * 0.09;
  const edges: Array<[number, number, number, number]> = [
    [-h + r, -h, h - r, -h],
    [h, -h + r, h, h - r],
    [h - r, h, -h + r, h],
    [-h, h - r, -h, -h + r],
  ];
  for (const [ax, ay, bx, by] of edges) {
    const len = Math.hypot(bx - ax, by - ay);
    const ux = (bx - ax) / len;
    const uy = (by - ay) / len;
    for (let t = 0; t < len; t += dash + gap) {
      const e = Math.min(len, t + dash);
      g.beginPath();
      g.moveTo(ax + ux * t, ay + uy * t);
      g.lineTo(ax + ux * e, ay + uy * e);
      g.strokePath();
    }
  }
  for (const [cx, cy, a0] of [[-h + r, -h + r, Math.PI], [h - r, -h + r, -Math.PI / 2], [h - r, h - r, 0], [-h + r, h - r, Math.PI / 2]] as const) {
    g.beginPath();
    g.arc(cx, cy, r, a0, a0 + Math.PI / 2);
    g.strokePath();
  }
}

export function drawStart(g: G, s: number, dx: number): void {
  const h = s / 2;
  g.fillStyle(C.wallSide, 1);
  g.fillTriangle(-h * 0.85, -h * 0.95, h * 0.85, -h * 0.95, 0, -h * 0.05);
  g.fillStyle(C.wallTop, 1);
  g.fillTriangle(-h * 0.85, -h * 1.05, h * 0.85, -h * 1.05, 0, -h * 0.2);
  g.fillStyle(C.yellow, 1);
  g.fillCircle(0, -h * 0.62, s * 0.08);
  if (dx !== 0) arrow(g, s, dx > 0 ? 0 : Math.PI, C.ink, 0, h * 0.35, 0.8);
}

export function drawTarget(g: G, s: number, kind: 'bell' | 'basket'): void {
  const h = s / 2;
  const d = depth(s);
  if (kind === 'bell') {
    g.fillStyle(0xc99a1c, 1);
    g.fillEllipse(0, h * 0.62, s * 0.78, s * 0.22);
    g.fillStyle(C.yellow, 1);
    g.beginPath();
    g.moveTo(-h * 0.72, h * 0.6);
    g.lineTo(-h * 0.5, -h * 0.25);
    g.arc(0, -h * 0.25, h * 0.5, Math.PI, 0);
    g.lineTo(h * 0.72, h * 0.6);
    g.closePath();
    g.fillPath();
    g.fillStyle(0xffffff, 0.45);
    g.fillEllipse(-h * 0.22, -h * 0.2, s * 0.12, s * 0.3);
    g.fillStyle(0x9a6f0c, 1);
    g.fillCircle(0, h * 0.68, s * 0.08);
  } else {
    g.fillStyle(0xb85d12, 1);
    g.beginPath();
    g.moveTo(-h * 0.82, -h * 0.25 + d * 0.4);
    g.lineTo(h * 0.82, -h * 0.25 + d * 0.4);
    g.lineTo(h * 0.58, h * 0.78);
    g.lineTo(-h * 0.58, h * 0.78);
    g.closePath();
    g.fillPath();
    g.fillStyle(C.orange, 1);
    g.beginPath();
    g.moveTo(-h * 0.82, -h * 0.25);
    g.lineTo(h * 0.82, -h * 0.25);
    g.lineTo(h * 0.62, h * 0.62);
    g.lineTo(-h * 0.62, h * 0.62);
    g.closePath();
    g.fillPath();
    g.fillStyle(0x7a3c07, 1);
    g.fillEllipse(0, -h * 0.25, s * 0.82, s * 0.18);
  }
}

export function drawCheckpoint(g: G, s: number, done: boolean): void {
  g.fillStyle(done ? C.blue : C.socket, done ? 0.9 : 1);
  g.fillCircle(0, 0, s * 0.3);
  g.lineStyle(Math.max(2, s * 0.08), C.blue, 1);
  g.strokeCircle(0, 0, s * 0.3);
}

export function drawSwitch(g: G, s: number, fired: boolean): void {
  const h = s / 2;
  g.fillStyle(C.wallSide, 1);
  g.fillRoundedRect(-h * 0.6, h * 0.42, h * 1.2, h * 0.32, 3);
  g.fillStyle(C.wallTop, 1);
  g.fillRoundedRect(-h * 0.6, h * 0.3, h * 1.2, h * 0.32, 3);
  const a = fired ? 0.6 : -0.6;
  g.lineStyle(Math.max(2, s * 0.09), C.ink, 0.9);
  g.beginPath();
  g.moveTo(0, h * 0.4);
  g.lineTo(Math.sin(a) * h * 0.8, h * 0.4 - Math.cos(a) * h * 0.8);
  g.strokePath();
  g.fillStyle(fired ? C.green : C.yellow, 1);
  g.fillCircle(Math.sin(a) * h * 0.8, h * 0.4 - Math.cos(a) * h * 0.8, s * 0.14);
}

export function drawGate(g: G, s: number, open: boolean): void {
  const h = s / 2;
  if (open) {
    g.lineStyle(Math.max(1.5, s * 0.05), C.gate, 0.5);
    g.strokeRoundedRect(-h * 0.85, -h * 0.85, h * 1.7, h * 1.7, s * 0.12);
    return;
  }
  box(g, s, C.gate, C.gateSide, s * 0.06, s * 0.12);
  g.fillStyle(0x000000, 0.25);
  const d = depth(s);
  for (const k of [-0.5, 0, 0.5]) g.fillRect(k * h - s * 0.05, -h + s * 0.12 - d, s * 0.1, s * 0.76);
}

/** Player pieces as raised objects. Fan blades are drawn separately so they can spin. */
export function drawPiece(g: G, type: PieceType, dir: Dir, s: number, alpha = 1): void {
  const h = s / 2;
  const d = depth(s);
  switch (type) {
    case 'RAMP': {
      const sx = dir === 'DR' ? 1 : -1;
      const w = s * 0.2;
      const x1 = -sx * h * 0.82;
      const y1 = -h * 0.55;
      const x2 = sx * h * 0.82;
      const y2 = h * 0.55;
      const len = Math.hypot(x2 - x1, y2 - y1);
      const nx = (-(y2 - y1) / len) * w;
      const ny = ((x2 - x1) / len) * w;
      const plank = (oy: number, color: number) => {
        g.fillStyle(color, alpha);
        g.beginPath();
        g.moveTo(x1 + nx, y1 + ny + oy);
        g.lineTo(x2 + nx, y2 + ny + oy);
        g.lineTo(x2 - nx, y2 - ny + oy);
        g.lineTo(x1 - nx, y1 - ny + oy);
        g.closePath();
        g.fillPath();
      };
      plank(0, C.rampSide);
      plank(-d, C.ramp);
      arrow(g, s, dirAngle(dir), 0xffffff, 0, -d, 0.85);
      break;
    }
    case 'SPRING': {
      box(g, s, C.spring, C.springSide, s * 0.08, s * 0.18, d, alpha);
      g.lineStyle(Math.max(2, s * 0.06), 0xffffff, 0.75 * alpha);
      for (const k of [-0.18, 0.02, 0.22]) {
        g.beginPath();
        g.moveTo(-h * 0.55, k * s - d);
        g.lineTo(h * 0.55, k * s - d);
        g.strokePath();
      }
      arrow(g, s, dirAngle(dir), C.ink, 0, -d, 0.95);
      break;
    }
    case 'FAN': {
      box(g, s, C.fan, C.fanSide, s * 0.06, s * 0.2, d, alpha);
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
