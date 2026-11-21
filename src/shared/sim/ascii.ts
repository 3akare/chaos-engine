/** Debug rendering of a board and a run as text (tests, tools). */
import { idx } from '../coords';
import { H, W, type BoardPiece, type SimResult } from '../types';
import type { Level } from './level';

const glyph: Record<string, string> = {
  'RAMP:DR': '\\',
  'RAMP:DL': '/',
  'SPRING:U': '^',
  'SPRING:UR': '>',
  'SPRING:UL': '<',
  'FAN:R': ')',
  'FAN:L': '(',
  'FAN:U': 'm',
  'BUMPER:L': '[',
  'BUMPER:R': ']',
};

export function renderAscii(level: Level, pieces: readonly BoardPiece[], run?: SimResult): string {
  const path = new Set<number>();
  if (run) for (const f of run.frames) if (f.x >= 0 && f.x < W && f.y >= 0 && f.y < H) path.add(idx(f.x, f.y));
  const pieceAt = new Map(pieces.map((p) => [idx(p.x, p.y), p]));
  const lines: string[] = ['   ABCDEFGHI'];
  for (let y = 0; y < H; y++) {
    let s = `${String(y + 1).padStart(2)} `;
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      const p = pieceAt.get(i);
      const k = level.kinds[i];
      let c = '.';
      if (p) c = glyph[`${p.type}:${p.dir}`] ?? '?';
      else if (k === 'solid') c = '#';
      else if (k === 'start') c = 'S';
      else if (k === 'target') c = 'T';
      else if (k === 'checkpoint') c = String(level.cp[i]);
      else if (k === 'switch') c = 'w';
      else if (k === 'gate') c = level.gateOpen[i] ? 'g' : 'G';
      else if (level.socket[i]) c = 'o';
      if (c === '.' || c === 'o') if (path.has(i)) c = c === 'o' ? '@' : '*';
      s += c;
    }
    lines.push(s);
  }
  if (run) lines.push(`end=${run.end} ticks=${run.ticks} P=${run.progress.join(',')}`);
  return lines.join('\n');
}
