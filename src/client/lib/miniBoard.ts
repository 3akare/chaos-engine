/** A small static board for the feed card and the seed gallery, drawn with the same sprites as the game. No Phaser. */
import { pieceLook, sprite } from '../assets';
import type { Dir, PieceType } from '../../shared/types';

type MiniPiece = { socket: string; type: PieceType; dir: Dir };
type Frame = { x: number; y: number };

export type MiniOptions = {
  pieces?: readonly MiniPiece[];
  path?: readonly Frame[];
  pathColor?: string;
  labels?: boolean;
  target?: 'bell' | 'basket';
};

const W = 9;
const H = 14;
const INK = '#353541';
const NAMES = ['ball', 'spot', 'flag_a', 'switch', 'lock', 'coin', 'ramp', 'spring_out', 'booster', 'bumper_out'];
const WALLS = ['block', 'block_top', 'block_top_left', 'block_top_right', 'block_left', 'block_right', 'block_center', 'block_bottom', 'block_bottom_left', 'block_bottom_right', 'horizontal_left', 'horizontal_middle', 'horizontal_right', 'vertical_top', 'vertical_middle', 'vertical_bottom'];
const imgs = new Map<string, HTMLImageElement>();
let ready: Promise<void> | null = null;

function load(): Promise<void> {
  ready ??= Promise.all(
    [...NAMES, ...WALLS.map((w) => `wall_${w}`)].map(
      (n) =>
        new Promise<void>((res) => {
          const i = new Image();
          i.onload = () => res();
          i.onerror = () => res();
          i.src = sprite(n);
          imgs.set(n, i);
        }),
    ),
  ).then(() => undefined);
  return ready;
}

function wallTile(up: boolean, down: boolean, left: boolean, right: boolean): string {
  if (!up && !down) return left && right ? 'horizontal_middle' : right ? 'horizontal_left' : left ? 'horizontal_right' : 'block';
  if (!left && !right) return up && down ? 'vertical_middle' : down ? 'vertical_top' : 'vertical_bottom';
  const row = !up ? 'top' : !down ? 'bottom' : '';
  const side = !left ? 'left' : !right ? 'right' : '';
  return row && side ? `block_${row}_${side}` : row ? `block_${row}` : side ? `block_${side}` : 'block_center';
}

/** Draw a machine to fill the canvas (once the sprites have loaded). */
export function drawMini(canvas: HTMLCanvasElement, rows: readonly string[], opts: MiniOptions = {}): void {
  void load().then(() => paint(canvas, rows, opts));
}

function paint(canvas: HTMLCanvasElement, rows: readonly string[], opts: MiniOptions): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cssW = canvas.clientWidth || canvas.width;
  const cssH = canvas.clientHeight || canvas.height;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, cssW, cssH);
  const gut = opts.labels ? 12 : 0;
  const s = Math.min((cssW - gut) / W, (cssH - gut) / H);
  const ox = (cssW - s * W + gut) / 2;
  const oy = (cssH - s * H + gut) / 2;
  const at = (x: number, y: number): string => rows[y]?.[x] ?? '.';
  const put = (name: string, x: number, y: number, k = 1, angle = 0, flip = false): void => {
    const i = imgs.get(name);
    if (!i || !i.complete || !i.naturalWidth) return;
    const cx = ox + (x + 0.5) * s;
    const cy = oy + (y + 0.5) * s;
    const d = s * k;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((angle * Math.PI) / 180);
    if (flip) ctx.scale(-1, 1);
    ctx.drawImage(i, -d / 2, -d / 2, d, d);
    ctx.restore();
  };
  if (opts.labels) {
    ctx.fillStyle = INK;
    ctx.font = `${Math.max(8, Math.round(s * 0.4))}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let x = 0; x < W; x++) ctx.fillText('ABCDEFGHI'[x]!, ox + (x + 0.5) * s, oy - gut / 2);
    for (let y = 0; y < H; y++) ctx.fillText(String(y + 1), ox - gut / 2, oy + (y + 0.5) * s);
  }
  const pieceAt = new Map<string, MiniPiece>();
  for (const p of opts.pieces ?? []) pieceAt.set(p.socket, p);
  let start: [number, number] | null = null;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ch = at(x, y);
      const p = pieceAt.get(`${'ABCDEFGHI'[x]}${y + 1}`);
      if (ch === '#') put(`wall_${wallTile(at(x, y - 1) === '#', at(x, y + 1) === '#', at(x - 1, y) === '#', at(x + 1, y) === '#')}`, x, y, 1.02);
      else if (ch === 'o' && !p) put('spot', x, y, 0.8);
      else if (ch === 'S') start = [x, y];
      else if (ch === 'T') put('flag_a', x, y, 1.05);
      else if (ch === 'w') put('switch', x, y);
      else if (ch === 'G') put('lock', x, y);
      else if (ch >= '1' && ch <= '9') put('coin', x, y, 1.4);
      if (p) {
        const l = pieceLook(p.type, p.dir);
        put(l.key, x, y, 1, l.angle, l.flip);
      }
    }
  }
  if (opts.path && opts.path.length > 1) {
    const seen = new Set<string>();
    for (const f of opts.path) {
      if (f.x < 0 || f.x >= W || f.y < 0 || f.y >= H) continue;
      const k = `${f.x},${f.y}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const cx = ox + (f.x + 0.5) * s;
      const cy = oy + (f.y + 0.5) * s;
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(2, s * 0.13), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = opts.pathColor ?? '#ffffff';
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(1.2, s * 0.085), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (start) put('ball', start[0], start[1], 0.78);
}
