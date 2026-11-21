import { parseLevel, simulate, type Level } from '../src/shared/sim';
import type { BoardPiece, Dir, Machine, Objective, PieceType, SimResult, VariantId } from '../src/shared/types';
import { H, W } from '../src/shared/types';

/** Build a level from a partial grid: rows are padded to 9 chars and 14 rows with '.'. A target is added at I14 if absent. */
export function grid(rows: string[], opts: { dx?: -1 | 0 | 1; objective?: Objective; links?: Machine['links'] } = {}): Level {
  const full = rows.map((r) => r.padEnd(W, '.'));
  while (full.length < H) full.push('.'.repeat(W));
  if (!full.some((r) => r.includes('T'))) full[H - 1] = full[H - 1]!.slice(0, W - 1) + 'T';
  return parseLevel({ rows: full, start: { dx: opts.dx ?? 1 }, links: opts.links ?? [], objective: opts.objective ?? { type: 'DELIVER' } });
}

let n = 0;
export const pc = (type: PieceType, dir: Dir, x: number, y: number, id?: string): BoardPiece => ({ id: id ?? `p${n++}`, type, dir, x, y });

export const run = (level: Level, pieces: BoardPiece[] = [], variant: VariantId = 'STANDARD'): SimResult => simulate(level, pieces, { variant });

/** Cells visited, as "x,y" strings in order (deduplicated consecutive). */
export function path(r: SimResult): string[] {
  const out: string[] = [];
  for (const f of r.frames) {
    const k = `${f.x},${f.y}`;
    if (out[out.length - 1] !== k) out.push(k);
  }
  return out;
}
export const visited = (r: SimResult, x: number, y: number): boolean => r.frames.some((f) => f.x === x && f.y === y);
