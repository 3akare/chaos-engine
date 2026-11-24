/** A tiny Canvas 2D renderer for static boards: the splash card and the seed gallery. No Phaser. */
import type { Dir, PieceType } from '../../shared/types';

type MiniPiece = { socket: string; type: PieceType; dir: Dir };
type Frame = { x: number; y: number };

const LIGHT = { board: '#fffaf6', edge: '#fff4ea', wall: '#f1cdbb', wallTop: '#ffffff', socket: '#f1c8b4', blue: '#7ab8ff', orange: '#ffc95e', yellow: '#ffc95e', red: '#ff8f8f', ink: '#5a3442', path: '#ff7b5c' };
const DARK = { board: '#3a2a4a', edge: '#3a2a4a', wall: '#c99f86', wallTop: '#f3d9c4', socket: '#5a4570', blue: '#8ec4ff', orange: '#ffd27a', yellow: '#ffd27a', red: '#ff9d9d', ink: '#fbe9dc', path: '#ff8f6b' };
const COL = { ...LIGHT };
function pickTheme(): void {
  const t = document.documentElement.dataset.theme;
  const dark = t === 'dark' || (t !== 'light' && typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches);
  Object.assign(COL, dark ? DARK : LIGHT);
}

export type MiniOptions = {
  pieces?: readonly MiniPiece[];
  path?: readonly Frame[];
  pathColor?: string;
  labels?: boolean;
  target?: 'bell' | 'basket';
};

const W = 9;
const H = 14;

function arrow(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, dir: Dir, color: string): void {
  const a: Record<string, number> = { R: 0, L: Math.PI, U: -Math.PI / 2, UR: -Math.PI / 4, UL: (-3 * Math.PI) / 4, DR: Math.PI / 4, DL: (3 * Math.PI) / 4 };
  const ang = a[dir] ?? 0;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ang);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(s * 0.32, 0);
  ctx.lineTo(-s * 0.12, -s * 0.22);
  ctx.lineTo(-s * 0.12, s * 0.22);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Draw a machine's rows (and optional pieces / path) to fill the canvas. Returns the cell size. */
export function drawMini(canvas: HTMLCanvasElement, rows: readonly string[], opts: MiniOptions = {}): number {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cssW = canvas.clientWidth || canvas.width;
  const cssH = canvas.clientHeight || canvas.height;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  pickTheme();
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  const gut = opts.labels ? 12 : 0;
  // Same proportions as the game board: a floor plate 0.35 cell wider than the grid on every side.
  const s = Math.floor(Math.min((cssW - gut) / (W + 0.7), (cssH - gut) / (H + 0.7)));
  const ox = Math.round((cssW - s * W + gut) / 2);
  const oy = Math.round((cssH - s * H + gut) / 2);
  const m = Math.round(s * 0.35);
  ctx.fillStyle = COL.wall;
  ctx.globalAlpha = 0.5;
  roundRect(ctx, ox - m, oy - m + 3, s * W + m * 2, s * H + m * 2, s * 0.7);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = COL.board;
  roundRect(ctx, ox - m, oy - m, s * W + m * 2, s * H + m * 2, s * 0.7);
  ctx.fill();
  if (opts.labels) {
    ctx.fillStyle = '#8b7f6a';
    ctx.font = `bold ${Math.max(8, Math.round(s * 0.42))}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let x = 0; x < W; x++) ctx.fillText('ABCDEFGHI'[x]!, ox + (x + 0.5) * s, oy - gut / 2 - 2);
    for (let y = 0; y < H; y++) ctx.fillText(String(y + 1), ox - gut / 2 - 3, oy + (y + 0.5) * s);
  }
  const pieceAt = new Map<string, MiniPiece>();
  for (const p of opts.pieces ?? []) pieceAt.set(p.socket, p);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ch = rows[y]?.[x] ?? '.';
      const px = ox + x * s;
      const py = oy + y * s;
      const cx = px + s / 2;
      const cy = py + s / 2;
      const p = pieceAt.get(`${'ABCDEFGHI'[x]}${y + 1}`);
      if (ch === '#') {
        const lift = Math.max(1, Math.round(s * 0.18));
        const up = rows[y - 1]?.[x] === '#';
        const dn = rows[y + 1]?.[x] === '#';
        const lf = rows[y]?.[x - 1] === '#';
        const rt = rows[y]?.[x + 1] === '#';
        const r = s * 0.24;
        ctx.fillStyle = COL.wall;
        roundRectC(ctx, px, py, s, s, [up || lf ? 0 : r, up || rt ? 0 : r, dn || rt ? 0 : r, dn || lf ? 0 : r]);
        ctx.fill();
        ctx.fillStyle = COL.wallTop;
        roundRectC(ctx, px, py - lift, s, dn ? s : s, [up || lf ? 0 : r, up || rt ? 0 : r, dn || rt ? 0 : r, dn || lf ? 0 : r]);
        ctx.fill();
      } else if (ch === 'o' && !p) {
        ctx.fillStyle = COL.socket;
        ctx.beginPath();
        ctx.arc(cx, cy, s * 0.2, 0, Math.PI * 2);
        ctx.fill();
      } else if (ch === 'S') {
        ctx.fillStyle = COL.wall;
        ctx.beginPath();
        ctx.moveTo(px + s * 0.12, py + s * 0.05);
        ctx.lineTo(px + s * 0.88, py + s * 0.05);
        ctx.lineTo(cx, py + s * 0.55);
        ctx.closePath();
        ctx.fill();
      } else if (ch === 'T') {
        ctx.fillStyle = '#7fd6a0';
        ctx.beginPath();
        ctx.ellipse(cx, cy + s * 0.08, s * 0.4, s * 0.26, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.beginPath();
        ctx.ellipse(cx, cy + s * 0.08, s * 0.22, s * 0.12, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (ch >= '1' && ch <= '9') {
        ctx.strokeStyle = COL.blue;
        ctx.lineWidth = Math.max(1, s * 0.1);
        ctx.beginPath();
        ctx.arc(cx, cy, s * 0.3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = COL.blue;
        ctx.font = `bold ${Math.round(s * 0.42)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(ch, cx, cy + 0.5);
      } else if (ch === 'w') {
        ctx.fillStyle = COL.yellow;
        ctx.beginPath();
        ctx.arc(cx, cy, s * 0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = COL.ink;
        ctx.lineWidth = Math.max(1, s * 0.06);
        ctx.stroke();
      } else if (ch === 'G' || ch === 'g') {
        ctx.fillStyle = ch === 'G' ? COL.orange : 'rgba(242,140,40,0.25)';
        for (let k = 0; k < 3; k++) ctx.fillRect(px + s * (0.15 + k * 0.28), py + s * 0.1, s * 0.16, s * 0.8);
      }
      if (p) {
        const color = p.type === 'RAMP' ? COL.blue : p.type === 'SPRING' ? COL.orange : p.type === 'FAN' ? '#7fd6a0' : COL.red;
        ctx.fillStyle = color;
        roundRect(ctx, px + s * 0.1, py + s * 0.1, s * 0.8, s * 0.8, s * (p.type === 'BUMPER' ? 0.4 : 0.18));
        ctx.fill();
        arrow(ctx, cx, cy, s, p.dir, '#fff');
      }
    }
  }
  if (opts.path && opts.path.length > 1) {
    ctx.fillStyle = opts.pathColor ?? COL.path;
    const seen = new Set<string>();
    for (const f of opts.path) {
      if (f.x < 0 || f.x >= W || f.y < 0 || f.y >= H) continue;
      const k = `${f.x},${f.y}`;
      if (seen.has(k)) continue;
      seen.add(k);
      ctx.beginPath();
      ctx.arc(ox + (f.x + 0.5) * s, oy + (f.y + 0.5) * s, Math.max(1.5, s * 0.1), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return s;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function roundRectC(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: [number, number, number, number]): void {
  ctx.beginPath();
  ctx.moveTo(x + r[0], y);
  ctx.arcTo(x + w, y, x + w, y + h, r[1]);
  ctx.arcTo(x + w, y + h, x, y + h, r[2]);
  ctx.arcTo(x, y + h, x, y, r[3]);
  ctx.arcTo(x, y, x + w, y, r[0]);
  ctx.closePath();
}
