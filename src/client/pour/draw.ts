/** Drawing the machine, the pieces and the balls on a 2D canvas, sharp at any pixel ratio. */
import { sprite } from '../assets';
import type { Pour } from '../../shared/pour/sim';
import { BALL_R, H, type Machine, type Piece, W } from '../../shared/pour/types';

export const INK = '#353541';
const BALL_LOOKS = ['ball', 'ball_blue', 'ball_green', 'ball_yellow', 'ball_purple'];

const IMG: Record<string, HTMLImageElement> = {};
export function img(name: string): HTMLImageElement {
  let i = IMG[name];
  if (!i) {
    i = new Image();
    i.src = sprite(name);
    IMG[name] = i;
  }
  return i;
}
export const ART = ['fan', 'fan_blades', 'spring', 'spring_out', ...BALL_LOOKS];
export const artReady = (): Promise<void> =>
  Promise.all(ART.map((n) => (img(n).complete ? Promise.resolve() : new Promise<void>((r) => ((img(n).onload = () => r()), (img(n).onerror = () => r())))))).then(() => undefined);

const rad = (d: number): number => (d * Math.PI) / 180;

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function withRot(c: CanvasRenderingContext2D, x: number, y: number, a: number, fn: () => void): void {
  c.save();
  c.translate(x, y);
  c.rotate(a);
  fn();
  c.restore();
}

/** Grass-topped dirt platform. */
function drawBlock(c: CanvasRenderingContext2D, b: Machine['blocks'][number]): void {
  withRot(c, b.x, b.y, rad(b.a), () => {
    const { w, h } = b;
    roundRect(c, -w / 2, -h / 2, w, h, 6);
    c.fillStyle = '#ee9366';
    c.fill();
    c.save();
    c.clip();
    c.fillStyle = '#de7e4f';
    for (let x = -w / 2; x < w / 2; x += 16) {
      c.beginPath();
      c.moveTo(x, h / 2);
      c.lineTo(x + 8, h / 2 - 5);
      c.lineTo(x + 16, h / 2);
      c.fill();
    }
    c.fillStyle = '#2ecc71';
    c.fillRect(-w / 2, -h / 2, w, 7);
    if (w > h) {
      c.fillStyle = '#46e087';
      c.fillRect(-w / 2, -h / 2, w, 3);
    }
    c.restore();
    roundRect(c, -w / 2, -h / 2, w, h, 6);
    c.lineWidth = 3;
    c.strokeStyle = INK;
    c.stroke();
  });
}

function drawPeg(c: CanvasRenderingContext2D, x: number, y: number): void {
  c.beginPath();
  c.arc(x, y, 7, 0, Math.PI * 2);
  c.fillStyle = '#b9c2ca';
  c.fill();
  c.lineWidth = 3;
  c.strokeStyle = INK;
  c.stroke();
  c.beginPath();
  c.arc(x - 2, y - 2, 2.2, 0, Math.PI * 2);
  c.fillStyle = '#fff';
  c.fill();
}

export function drawPlank(c: CanvasRenderingContext2D, len: number, th: number): void {
  roundRect(c, -len / 2, -th / 2, len, th, 5);
  c.fillStyle = '#c97f4a';
  c.fill();
  c.fillStyle = '#e09a62';
  c.fillRect(-len / 2 + 3, -th / 2 + 2, len - 6, 3);
  roundRect(c, -len / 2, -th / 2, len, th, 5);
  c.lineWidth = 3;
  c.strokeStyle = INK;
  c.stroke();
}

export function drawBumper(c: CanvasRenderingContext2D, x: number, y: number, flash: number, r = 17): void {
  c.beginPath();
  c.arc(x, y, r + flash * 4, 0, Math.PI * 2);
  c.fillStyle = flash > 0 ? '#ffd27a' : '#e54341';
  c.fill();
  c.lineWidth = 3;
  c.strokeStyle = INK;
  c.stroke();
  c.beginPath();
  c.arc(x, y, r * 0.6, 0, Math.PI * 2);
  c.fillStyle = '#fff';
  c.fill();
  c.stroke();
  c.beginPath();
  c.arc(x, y, r * 0.24, 0, Math.PI * 2);
  c.fillStyle = '#e54341';
  c.fill();
}

export function drawPiece(c: CanvasRenderingContext2D, p: Piece, t: number, alpha = 1, flash = 0): void {
  c.globalAlpha = alpha;
  const a = rad(p.a);
  if (p.type === 'ramp') withRot(c, p.x, p.y, a, () => drawPlank(c, 84, 12));
  if (p.type === 'spring') withRot(c, p.x, p.y, a, () => c.drawImage(img(flash > 0 ? 'spring' : 'spring_out'), -24, -34, 48, 48));
  if (p.type === 'bumper') drawBumper(c, p.x, p.y, flash);
  if (p.type === 'fan') {
    // Wind streaks flowing out of the fan.
    const ax = Math.cos(a);
    const ay = Math.sin(a);
    c.lineCap = 'round';
    for (let lane = -1; lane <= 1; lane++)
      for (let k = 0; k < 4; k++) {
        const d = 26 + ((t * 1.6 + k * 32 + lane * 11) % 128);
        const sx = p.x + ax * d - ay * lane * 13;
        const sy = p.y + ay * d + ax * lane * 13;
        c.globalAlpha = alpha * 0.85 * (1 - d / 160);
        c.lineWidth = 6;
        c.strokeStyle = INK;
        c.beginPath();
        c.moveTo(sx, sy);
        c.lineTo(sx + ax * 14, sy + ay * 14);
        c.stroke();
        c.lineWidth = 3;
        c.strokeStyle = '#fff';
        c.stroke();
      }
    c.globalAlpha = alpha;
    c.drawImage(img('fan'), p.x - 20, p.y - 20, 40, 40);
    withRot(c, p.x, p.y - 1.9, t * 0.25, () => c.drawImage(img('fan_blades'), -20, -20, 40, 40));
    withRot(c, p.x, p.y, a, () => {
      c.fillStyle = '#ffc851';
      c.strokeStyle = INK;
      c.lineWidth = 2.5;
      c.beginPath();
      c.moveTo(30, 0);
      c.lineTo(20, -7);
      c.lineTo(20, 7);
      c.closePath();
      c.fill();
      c.stroke();
    });
  }
  c.globalAlpha = 1;
}

function drawBucket(c: CanvasRenderingContext2D, bk: Machine['bucket'], glow: number): void {
  const x = bk.x - bk.w / 2 - 8;
  const y = bk.y - 32;
  const w = bk.w + 16;
  const h = 56;
  c.beginPath();
  c.moveTo(x, y);
  c.lineTo(x + 6, y + h);
  c.lineTo(x + w - 6, y + h);
  c.lineTo(x + w, y);
  c.closePath();
  c.fillStyle = glow > 0 ? '#ffe08a' : '#ffc851';
  c.fill();
  c.lineWidth = 3.5;
  c.strokeStyle = INK;
  c.stroke();
  c.fillStyle = '#e39b1f';
  c.fillRect(x + 5, y + h - 14, w - 10, 8);
}

function drawChute(c: CanvasRenderingContext2D, sp: Machine['spawn']): void {
  c.fillStyle = '#b9c2ca';
  roundRect(c, sp.x - 20, -6, 40, 22, 6);
  c.fill();
  c.lineWidth = 3;
  c.strokeStyle = INK;
  c.stroke();
  c.fillStyle = '#4a5066';
  roundRect(c, sp.x - 11, 4, 22, 8, 3);
  c.fill();
}

export const ballLook = (n: number): string => BALL_LOOKS[n % BALL_LOOKS.length]!;

export type Scene = {
  machine: Machine;
  pieces: readonly Piece[];
  pour: Pour | null;
  /** Piece being dragged (drawn on top), and whether it is over the board. */
  drag?: { piece: Piece; onBoard: boolean } | null;
  selected?: Piece | null;
  flashes: Map<unknown, number>;
  count: number | null;
  pops: { x: number; y: number; t: number }[];
  now: number;
  /** Skip the faint board frame (when something else frames it). */
  bare?: boolean;
};

/** Fit the 360×600 board in the canvas, centred, at the device's pixel ratio. */
export class View {
  scale = 1;
  ox = 0;
  oy = 0;
  dpr = 1;
  /** Sit the board on the bottom edge (spare room becomes sky above it). */
  alignBottom = false;
  constructor(readonly canvas: HTMLCanvasElement) {}

  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(3, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * this.dpr));
    this.scale = Math.min(r.width / W, r.height / H);
    this.ox = (r.width - W * this.scale) / 2;
    this.oy = this.alignBottom ? r.height - H * this.scale : (r.height - H * this.scale) / 2;
  }

  toWorld(clientX: number, clientY: number): { x: number; y: number; inside: boolean } {
    const r = this.canvas.getBoundingClientRect();
    return { x: (clientX - r.left - this.ox) / this.scale, y: (clientY - r.top - this.oy) / this.scale, inside: clientY >= r.top && clientY <= r.bottom };
  }

  render(s: Scene): void {
    const c = this.canvas.getContext('2d')!;
    const t = s.now / 16.7;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.setTransform(this.dpr * this.scale, 0, 0, this.dpr * this.scale, this.dpr * this.ox, this.dpr * this.oy);
    if (!s.bare) {
      c.fillStyle = 'rgba(255,255,255,.14)';
      roundRect(c, 0, 0, W, H, 18);
      c.fill();
    }
    const m = s.machine;
    drawChute(c, m.spawn);
    for (const b of m.blocks) drawBlock(c, b);
    for (const [x, y] of m.pegs) drawPeg(c, x, y);
    m.spinners.forEach((sp, i) => {
      const angle = s.pour ? s.pour.spinners[i]!.body.angle : 0; // at rest in the pose every pour starts from
      withRot(c, sp.x, sp.y, angle, () => {
        drawPlank(c, sp.len, 12);
        c.beginPath();
        c.arc(0, 0, 6, 0, Math.PI * 2);
        c.fillStyle = '#ffc851';
        c.fill();
        c.lineWidth = 3;
        c.strokeStyle = INK;
        c.stroke();
      });
    });
    drawBucket(c, m.bucket, s.flashes.get('bucket') ?? 0);
    s.pieces.forEach((p, i) => {
      if (p !== s.drag?.piece) drawPiece(c, p, t, 1, s.flashes.get(i) ?? 0);
    });
    if (s.pour) {
      for (const b of s.pour.balls) {
        const im = img(ballLook(b.n));
        withRot(c, b.position.x, b.position.y, b.angle, () => c.drawImage(im, -BALL_R - 1, -BALL_R - 1, (BALL_R + 1) * 2, (BALL_R + 1) * 2));
      }
    }
    if (s.drag) {
      drawPiece(c, s.drag.piece, t, s.drag.onBoard ? 1 : 0.6);
      if (s.drag.onBoard) ring(c, s.drag.piece, INK, 2, true);
    }
    if (s.selected) ring(c, s.selected, '#ffc851', 3, false);
    if (s.count !== null) {
      const bk = m.bucket;
      const k = 1 + (s.flashes.get('count') ?? 0) * 0.25;
      c.font = '30px "Lilita One", sans-serif';
      c.textAlign = 'center';
      c.lineJoin = 'round';
      withRot(c, bk.x, bk.y - 52, 0, () => {
        c.scale(k, k);
        c.lineWidth = 7;
        c.strokeStyle = INK;
        c.strokeText(String(s.count), 0, 0);
        c.fillStyle = '#fff';
        c.fillText(String(s.count), 0, 0);
      });
    }
    c.font = '16px "Lilita One", sans-serif';
    c.textAlign = 'center';
    for (const p of s.pops) {
      const k = (s.now - p.t) / 600;
      if (k < 0 || k > 1) continue;
      c.globalAlpha = 1 - k;
      c.lineWidth = 5;
      c.strokeStyle = INK;
      c.strokeText('+1', p.x, p.y - k * 30);
      c.fillStyle = '#ffc851';
      c.fillText('+1', p.x, p.y - k * 30);
    }
    c.globalAlpha = 1;
  }
}

function ring(c: CanvasRenderingContext2D, p: Piece, color: string, width: number, dashed: boolean): void {
  c.beginPath();
  c.arc(p.x, p.y, 34, 0, Math.PI * 2);
  c.lineWidth = width;
  if (dashed) c.setLineDash([5, 5]);
  c.strokeStyle = color;
  c.stroke();
  c.setLineDash([]);
}

/** A still picture of a machine (and optionally a build) for cards and lists. */
export function drawStill(canvas: HTMLCanvasElement, machine: Machine, pieces: readonly Piece[] = []): void {
  const v = new View(canvas);
  v.resize();
  v.render({ machine, pieces, pour: null, flashes: new Map(), count: null, pops: [], now: 0 });
}
