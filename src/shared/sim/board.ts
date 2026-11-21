import { parseCell } from '../coords';
import type { BoardPiece, Dir, Machine, PieceType } from '../types';
import { parseLevel, type Level } from './level';

export type Board = { level: Level; pieces: BoardPiece[] };

const levelCache = new WeakMap<object, Level>();
/** Parse once per Machine object. */
export function levelOf(m: Machine): Level {
  let l = levelCache.get(m);
  if (!l) {
    l = parseLevel(m);
    levelCache.set(m, l);
  }
  return l;
}

/** A piece keyed by socket name ("C7"), as stored server-side. */
export type SocketPiece = { socket: string; type: PieceType; dir: Dir; id: string };

export function toBoardPieces(pieces: readonly SocketPiece[]): BoardPiece[] {
  const out: BoardPiece[] = [];
  for (const p of pieces) {
    const c = parseCell(p.socket);
    if (c) out.push({ id: p.id, type: p.type, dir: p.dir, x: c[0], y: c[1] });
  }
  return out;
}

export function solutionPieces(m: Machine): BoardPiece[] {
  return toBoardPieces((m.solution ?? []).map((s, i) => ({ ...s, id: `sol${i}` })));
}
