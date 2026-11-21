/** Procedural drawing of cells and pieces (§7.4–7.5). Everything is centred on (0,0), cell size `s`. */
import type * as Phaser from 'phaser';
import type { Dir, PieceType } from '../../../shared/types';
import { C } from '../theme';

type G = Phaser.GameObjects.Graphics;

const OUT = (s: number): number => Math.max(1.5, s * 0.055);

export function arrow(g: G, s: number, angle: number, color: number = C.white, len = 0.5): void {
  const L = s * len * 0.5;
  const w = s * 0.13;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const tip = { x: cos * L, y: sin * L };
  const back = { x: -cos * L * 0.8, y: -sin * L * 0.8 };
  g.lineStyle(Math.max(2, s * 0.09), color, 1);
  g.beginPath();
  g.moveTo(back.x, back.y);
  g.lineTo(tip.x - cos * w * 0.6, tip.y - sin * w * 0.6);
  g.strokePath();
  g.fillStyle(color, 1);
  g.fillTriangle(
    tip.x,
    tip.y,
    tip.x - cos * w * 1.6 - sin * w,
    tip.y - sin * w * 1.6 + cos * w,
    tip.x - cos * w * 1.6 + sin * w,
    tip.y - sin * w * 1.6 - cos * w,
  );
}

const ANG: Record<string, number> = {
  R: 0,
  L: Math.PI,
  U: -Math.PI / 2,
  UR: -Math.PI / 4,
  UL: (-3 * Math.PI) / 4,
  DR: Math.PI / 4,
  DL: (3 * Math.PI) / 4,
};
export const dirAngle = (d: Dir): number => ANG[d] ?? 0;

export function drawWall(g: G, s: number, top: boolean): void {
  const h = s / 2;
  g.fillStyle(C.wall, 1);
  g.fillRoundedRect(-h, -h, s, s, Math.max(2, s * 0.12));
  if (top) {
    g.fillStyle(C.wallTop, 1);
    g.fillRoundedRect(-h + s * 0.08, -h + s * 0.06, s * 0.84, s * 0.16, Math.max(1, s * 0.06));
  }
}

export function drawSocket(g: G, s: number, highlight = false): void {
  const h = s * 0.42;
  const color = highlight ? C.blue : C.socket;
  g.lineStyle(Math.max(1.5, s * 0.05), color, highlight ? 1 : 0.9);
  const dash = s * 0.14;
  const gap = s * 0.09;
  const r = s * 0.12;
  // Dashed rounded square, approximated by straight dashed edges and corner arcs.
  const edges: Array<[number, number, number, number]> = [
    [-h + r, -h, h - r, -h],
    [h, -h + r, h, h - r],
    [h - r, h, -h + r, h],
    [-h, h - r, -h, -h + r],
  ];
  for (const [x1, y1, x2, y2] of edges) {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const ux = (x2 - x1) / len;
    const uy = (y2 - y1) / len;
    for (let t = 0; t < len; t += dash + gap) {
      const e = Math.min(len, t + dash);
      g.beginPath();
      g.moveTo(x1 + ux * t, y1 + uy * t);
      g.lineTo(x1 + ux * e, y1 + uy * e);
      g.strokePath();
    }
  }
  const corners: Array<[number, number, number]> = [
    [-h + r, -h + r, Math.PI],
    [h - r, -h + r, -Math.PI / 2],
    [h - r, h - r, 0],
    [-h + r, h - r, Math.PI / 2],
  ];
  for (const [cx, cy, a] of corners) {
    g.beginPath();
    g.arc(cx, cy, r, a, a + Math.PI / 2);
    g.strokePath();
  }
  if (highlight) {
    g.fillStyle(C.blue, 0.1);
    g.fillRoundedRect(-h, -h, h * 2, h * 2, r);
  }
}

export function drawStart(g: G, s: number, dx: number): void {
  const h = s / 2;
  g.fillStyle(C.ink, 0.85);
  g.fillTriangle(-h * 0.8, -h, h * 0.8, -h, 0, -h * 0.2);
  g.fillStyle(C.yellow, 1);
  g.fillCircle(0, -h * 0.62, s * 0.08);
  if (dx !== 0) arrow(g, s * 0.8, dx > 0 ? 0 : Math.PI, C.ink, 0.6);
}

export function drawTarget(g: G, s: number, kind: 'bell' | 'basket'): void {
  const h = s / 2;
  if (kind === 'bell') {
    g.fillStyle(C.yellow, 1);
    g.lineStyle(OUT(s), C.ink, 1);
    g.beginPath();
    g.moveTo(-h * 0.7, h * 0.45);
    g.lineTo(-h * 0.5, -h * 0.2);
    g.arc(0, -h * 0.2, h * 0.5, Math.PI, 0);
    g.lineTo(h * 0.7, h * 0.45);
    g.closePath();
    g.fillPath();
    g.strokePath();
    g.fillStyle(C.orangeDark, 1);
    g.fillCircle(0, h * 0.6, s * 0.09);
    g.fillStyle(C.ink, 1);
    g.fillRect(-s * 0.04, -h * 0.85, s * 0.08, s * 0.15);
  } else {
    g.fillStyle(C.orange, 1);
    g.lineStyle(OUT(s), C.ink, 1);
    g.beginPath();
    g.moveTo(-h * 0.8, -h * 0.25);
    g.lineTo(h * 0.8, -h * 0.25);
    g.lineTo(h * 0.55, h * 0.75);
    g.lineTo(-h * 0.55, h * 0.75);
    g.closePath();
    g.fillPath();
    g.strokePath();
    g.lineStyle(Math.max(1, s * 0.04), C.orangeDark, 1);
    for (const t of [-0.3, 0, 0.3]) {
      g.beginPath();
      g.moveTo(h * t * 1.6, -h * 0.2);
      g.lineTo(h * t * 1.1, h * 0.7);
      g.strokePath();
    }
  }
}

export function drawCheckpoint(g: G, s: number, done: boolean): void {
  g.lineStyle(Math.max(2, s * 0.08), C.blue, 1);
  g.fillStyle(done ? C.blue : C.white, done ? 0.9 : 0.6);
  g.fillCircle(0, 0, s * 0.3);
  g.strokeCircle(0, 0, s * 0.3);
}

export function drawSwitch(g: G, s: number, fired: boolean): void {
  const h = s / 2;
  g.fillStyle(C.ink, 1);
  g.fillRoundedRect(-h * 0.6, h * 0.35, h * 1.2, h * 0.35, 2);
  g.lineStyle(Math.max(2, s * 0.09), C.ink, 1);
  const a = fired ? 0.6 : -0.6;
  g.beginPath();
  g.moveTo(0, h * 0.4);
  g.lineTo(Math.sin(a) * h * 0.8, h * 0.4 - Math.cos(a) * h * 0.8);
  g.strokePath();
  g.fillStyle(fired ? C.green : C.yellow, 1);
  g.fillCircle(Math.sin(a) * h * 0.8, h * 0.4 - Math.cos(a) * h * 0.8, s * 0.13);
}

export function drawGate(g: G, s: number, open: boolean): void {
  const h = s / 2;
  if (open) {
    g.lineStyle(Math.max(1, s * 0.04), C.orangeDark, 0.5);
    g.strokeRect(-h * 0.85, -h * 0.85, h * 1.7, h * 1.7);
    return;
  }
  g.fillStyle(C.ink, 1);
  g.fillRect(-h * 0.9, -h * 0.9, h * 1.8, h * 1.8);
  g.fillStyle(C.orange, 1);
  for (let i = -2; i <= 2; i += 2) g.fillRect(i * h * 0.3 - h * 0.12, -h * 0.8, h * 0.24, h * 1.6);
}

/** Player pieces. `color` overrides the body colour (ghost previews). */
export function drawPiece(g: G, type: PieceType, dir: Dir, s: number, alpha = 1): void {
  const h = s / 2;
  const o = OUT(s);
  g.lineStyle(o, C.ink, alpha);
  switch (type) {
    case 'RAMP': {
      // A chunky plank sloping down in its direction, with an arrow.
      const sx = dir === 'DR' ? 1 : -1;
      const w = s * 0.2;
      const x1 = -sx * h * 0.82;
      const y1 = -h * 0.55;
      const x2 = sx * h * 0.82;
      const y2 = h * 0.55;
      const len = Math.hypot(x2 - x1, y2 - y1);
      const nx = (-(y2 - y1) / len) * w;
      const ny = ((x2 - x1) / len) * w;
      g.fillStyle(C.blue, alpha);
      g.beginPath();
      g.moveTo(x1 + nx, y1 + ny);
      g.lineTo(x2 + nx, y2 + ny);
      g.lineTo(x2 - nx, y2 - ny);
      g.lineTo(x1 - nx, y1 - ny);
      g.closePath();
      g.fillPath();
      g.strokePath();
      arrow(g, s * 0.95, dirAngle(dir), C.white, 0.55);
      break;
    }
    case 'SPRING': {
      // Base, coil, top plate; launch arrow on a badge.
      g.fillStyle(C.ink, alpha);
      g.fillRoundedRect(-h * 0.8, h * 0.55, h * 1.6, h * 0.35, 2);
      g.lineStyle(Math.max(2, s * 0.07), C.yellow, alpha);
      g.beginPath();
      const zig = 4;
      for (let i = 0; i <= zig; i++) {
        const yy = h * 0.55 - (i / zig) * h * 0.85;
        const xx = (i % 2 === 0 ? -1 : 1) * h * 0.5;
        if (i === 0) g.moveTo(xx, yy);
        else g.lineTo(xx, yy);
      }
      g.strokePath();
      g.fillStyle(C.orange, alpha);
      g.lineStyle(o, C.ink, alpha);
      g.fillRoundedRect(-h * 0.85, -h * 0.55, h * 1.7, h * 0.4, 3);
      g.strokeRoundedRect(-h * 0.85, -h * 0.55, h * 1.7, h * 0.4, 3);
      arrow(g, s * 0.9, dirAngle(dir), C.ink, 0.5);
      break;
    }
    case 'FAN': {
      g.fillStyle(C.wallTop, alpha);
      g.fillRoundedRect(-h * 0.9, -h * 0.9, s * 0.9, s * 0.9, s * 0.18);
      g.strokeRoundedRect(-h * 0.9, -h * 0.9, s * 0.9, s * 0.9, s * 0.18);
      g.fillStyle(C.white, alpha * 0.95);
      g.fillCircle(0, 0, h * 0.62);
      // the arrow shows the blowing direction
      const a = dirAngle(dir);
      g.fillStyle(C.blue, alpha);
      g.fillCircle(Math.cos(a) * h * 0.72, Math.sin(a) * h * 0.72, s * 0.11);
      break;
    }
    case 'BUMPER': {
      g.fillStyle(C.red, alpha);
      g.fillCircle(0, 0, h * 0.82);
      g.strokeCircle(0, 0, h * 0.82);
      g.fillStyle(0xff8a8d, alpha);
      g.fillCircle(-h * 0.25, -h * 0.3, h * 0.2);
      arrow(g, s * 0.95, dirAngle(dir), C.white, 0.55);
      break;
    }
  }
}

/** Fan blades are a separate graphic so they can spin. */
export function drawFanBlades(g: G, s: number, dir: Dir, alpha = 1): void {
  const h = s / 2;
  g.fillStyle(C.blue, alpha);
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI * 2) / 3;
    g.fillEllipse(Math.cos(a) * h * 0.28, Math.sin(a) * h * 0.28, h * 0.5, h * 0.24);
  }
  g.fillStyle(C.ink, alpha);
  g.fillCircle(0, 0, h * 0.12);
  void dir;
}

export function drawBall(g: G, s: number): void {
  const r = s * 0.3;
  g.fillStyle(0x000000, 0.18);
  g.fillEllipse(r * 0.15, r * 0.9, r * 1.6, r * 0.5);
  g.fillStyle(C.ball, 1);
  g.fillCircle(0, 0, r);
  g.lineStyle(Math.max(1.5, s * 0.045), C.ink, 1);
  g.strokeCircle(0, 0, r);
  g.fillStyle(C.ballHi, 0.9);
  g.fillCircle(-r * 0.35, -r * 0.38, r * 0.28);
}
