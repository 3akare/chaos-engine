/** Small canvas icons for pieces (palette buttons, cards). */
import type { Dir, PieceType } from '../../../shared/types';

const ANG: Record<string, number> = { R: 0, L: Math.PI, U: -Math.PI / 2, UR: -Math.PI / 4, UL: (-3 * Math.PI) / 4, DR: Math.PI / 4, DL: (3 * Math.PI) / 4 };
// Same colours as the board pieces (theme.ts).
const COLOR: Record<PieceType, [string, string]> = { RAMP: ['#7ab8ff', '#4f8fe0'], SPRING: ['#ffc95e', '#e0a033'], FAN: ['#7fd6a0', '#4fb07a'], BUMPER: ['#ff8f8f', '#e0606b'] };

export function pieceIcon(type: PieceType, dir: Dir, size = 38): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = size * dpr;
  c.height = size * dpr;
  c.style.width = `${size}px`;
  c.style.height = `${size}px`;
  const g = c.getContext('2d')!;
  g.scale(dpr, dpr);
  const s = size;
  const d = Math.round(s * 0.14);
  const [top, side] = COLOR[type];
  const shape = (oy: number) => {
    g.beginPath();
    if (type === 'BUMPER') g.ellipse(s / 2, s / 2 + oy, s * 0.4, s * 0.38, 0, 0, Math.PI * 2);
    else g.roundRect(s * 0.08, s * 0.1 + oy, s * 0.84, s * 0.78, s * 0.2);
  };
  g.fillStyle = side;
  shape(d / 2);
  g.fill();
  g.fillStyle = top;
  shape(-d / 2);
  g.fill();
  g.save();
  g.translate(s / 2, s / 2 - d / 2);
  g.rotate(ANG[dir] ?? 0);
  g.fillStyle = '#fff';
  g.beginPath();
  g.moveTo(s * 0.26, 0);
  g.lineTo(-s * 0.04, -s * 0.17);
  g.lineTo(-s * 0.04, s * 0.17);
  g.closePath();
  g.fill();
  g.fillRect(-s * 0.26, -s * 0.055, s * 0.24, s * 0.11);
  g.restore();
  return c;
}

export const PIECE_LABEL: Record<PieceType, string> = { RAMP: 'Ramp', SPRING: 'Spring', FAN: 'Fan', BUMPER: 'Bumper' };
export const DIR_LABEL: Record<Dir, string> = { DL: '↙ down-left', DR: '↘ down-right', U: '↑ up', UL: '↖ up-left', UR: '↗ up-right', L: '← left', R: '→ right' };
