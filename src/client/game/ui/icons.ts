/** Small canvas icons for pieces (palette buttons, cards). */
import type { Dir, PieceType } from '../../../shared/types';

const ANG: Record<string, number> = { R: 0, L: Math.PI, U: -Math.PI / 2, UR: -Math.PI / 4, UL: (-3 * Math.PI) / 4, DR: Math.PI / 4, DL: (3 * Math.PI) / 4 };
const COLOR: Record<PieceType, string> = { RAMP: '#2f6fdb', SPRING: '#f28c28', FAN: '#52587a', BUMPER: '#e5484d' };

export function pieceIcon(type: PieceType, dir: Dir, size = 34): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = size * dpr;
  c.height = size * dpr;
  c.style.width = `${size}px`;
  c.style.height = `${size}px`;
  const g = c.getContext('2d')!;
  g.scale(dpr, dpr);
  const s = size;
  g.fillStyle = COLOR[type];
  g.strokeStyle = '#2b2d3a';
  g.lineWidth = 2;
  g.beginPath();
  if (type === 'BUMPER') g.arc(s / 2, s / 2, s * 0.42, 0, Math.PI * 2);
  else if (type === 'RAMP') {
    const sx = dir === 'DR' ? 1 : -1;
    g.moveTo(s / 2 - sx * s * 0.45, s * 0.2);
    g.lineTo(s / 2 + sx * s * 0.45, s * 0.8);
    g.lineTo(s / 2 + sx * s * 0.45, s * 0.95);
    g.lineTo(s / 2 - sx * s * 0.45, s * 0.38);
  } else g.roundRect(s * 0.08, s * 0.08, s * 0.84, s * 0.84, s * 0.2);
  g.closePath();
  g.fill();
  g.stroke();
  g.save();
  g.translate(s / 2, s / 2);
  g.rotate(ANG[dir] ?? 0);
  g.fillStyle = '#fff';
  g.beginPath();
  g.moveTo(s * 0.3, 0);
  g.lineTo(-s * 0.1, -s * 0.2);
  g.lineTo(-s * 0.1, s * 0.2);
  g.closePath();
  g.fill();
  g.fillRect(-s * 0.3, -s * 0.06, s * 0.25, s * 0.12);
  g.restore();
  return c;
}

export const PIECE_LABEL: Record<PieceType, string> = { RAMP: 'Ramp', SPRING: 'Spring', FAN: 'Fan', BUMPER: 'Bumper' };
export const DIR_LABEL: Record<Dir, string> = { DL: '↙ down-left', DR: '↘ down-right', U: '↑ up', UL: '↖ up-left', UR: '↗ up-right', L: '← left', R: '→ right' };
