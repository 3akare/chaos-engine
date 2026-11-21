/**
 * The §2.5 action matrix, as a pure function. The server runs it inside a Redis
 * transaction; the client runs it for previews. Server results are authoritative.
 */
import { cellName, parseCell } from '../coords';
import type { ErrorCode, StoredPiece } from '../protocol';
import { simulate } from '../sim/engine';
import type { Level } from '../sim/level';
import { compareProgress } from '../sim/progress';
import { PIECE_DIRS, W, type BoardPiece, type Dir, type PieceType, type Progress, type SimResult } from '../types';
import { verdict, type Verdict } from './explain';

export type BoardState = {
  /** socket name → piece */
  pieces: Record<string, StoredPiece>;
  inventory: Record<PieceType, number>;
  /** userId → socket name */
  holders: Record<string, string>;
};

export type Actor = { userId: string; username: string };

export type Action =
  | { kind: 'set'; socket: string; type: PieceType; dir: Dir }
  | { kind: 'remove' };

export type ActionKind = 'place' | 'replace' | 'move' | 'edit' | 'move-replace' | 'remove';

export type Decision =
  | {
      ok: true;
      kind: ActionKind;
      next: BoardState;
      /** The new piece (absent for remove). */
      piece?: StoredPiece;
      /** Your own piece that left its old socket (move / remove / edit replaces in place). */
      own?: StoredPiece;
      /** Someone else's piece that was removed. */
      displaced?: StoredPiece;
      before: Progress;
      after: Progress;
      raised: boolean;
      verdict: Verdict;
    }
  | { ok: false; code: ErrorCode; message: string; verdict?: Verdict };

export const boardPieces = (pieces: Record<string, StoredPiece>): BoardPiece[] => {
  const out: BoardPiece[] = [];
  for (const p of Object.values(pieces)) {
    const c = parseCell(p.socket);
    if (c) out.push({ id: p.pieceId, type: p.type, dir: p.dir, x: c[0], y: c[1] });
  }
  return out;
};

const TYPE_NAME: Record<PieceType, string> = { RAMP: 'ramp', SPRING: 'spring', FAN: 'fan', BUMPER: 'bumper' };
export const pieceName = (t: PieceType): string => TYPE_NAME[t];

export function ball1(level: Level, pieces: Record<string, StoredPiece>): SimResult {
  return simulate(level, boardPieces(pieces));
}

/**
 * Decide an action. `newPieceId` and `now` are supplied by the caller so the function stays pure.
 * `level` must be the Day's parsed machine.
 */
export function decide(level: Level, state: BoardState, actor: Actor, action: Action, now: number, newPieceId: string): Decision {
  const held = state.holders[actor.userId];
  const own = held ? state.pieces[held] : undefined;
  const next: BoardState = { pieces: { ...state.pieces }, inventory: { ...state.inventory }, holders: { ...state.holders } };
  const beforeRun = ball1(level, state.pieces);

  if (action.kind === 'remove') {
    if (!held || !own) return { ok: false, code: 'NO_PIECE', message: "You don't have a piece on the board." };
    delete next.pieces[held];
    delete next.holders[actor.userId];
    next.inventory[own.type] = (next.inventory[own.type] ?? 0) + 1;
    const afterRun = ball1(level, next.pieces);
    const v = verdict(level, beforeRun, afterRun, beforeRun.touchedPieceIds.includes(own.pieceId));
    if (compareProgress(afterRun.progress, beforeRun.progress) < 0) {
      return { ok: false, code: 'WOULD_HURT', message: `Removing it would lower Ball 1's progress. ${v.reason}`, verdict: v };
    }
    return { ok: true, kind: 'remove', next, own, before: beforeRun.progress, after: afterRun.progress, raised: false, verdict: v };
  }

  const { socket, type, dir } = action;
  if (!PIECE_DIRS[type]?.includes(dir)) return { ok: false, code: 'BAD_PIECE', message: "That piece can't face that way." };
  const cell = parseCell(socket);
  if (!cell) return { ok: false, code: 'NOT_A_SOCKET', message: `${socket} isn't a cell on this board.` };
  const name = cellName(cell[0], cell[1]);
  const i = cell[1] * W + cell[0];
  if (!level.socket[i]) {
    const k = level.kinds[i];
    if (k !== 'empty') return { ok: false, code: 'NOT_REPLACEABLE', message: `${name} is part of the machine itself and can't be changed.` };
    return { ok: false, code: 'NOT_A_SOCKET', message: `${name} isn't a socket. Pieces only go in the dashed squares.` };
  }
  const target = state.pieces[name];
  const isOwnTarget = target !== undefined && target.userId === actor.userId && !target.setup;
  if (isOwnTarget && target.type === type && target.dir === dir) return { ok: false, code: 'NO_CHANGE', message: "That's already your piece." };

  // 1. Return to stock every piece this action removes.
  if (own) {
    delete next.pieces[own.socket];
    delete next.holders[actor.userId];
    next.inventory[own.type] = (next.inventory[own.type] ?? 0) + 1;
  }
  let displaced: StoredPiece | undefined;
  if (target && !isOwnTarget) {
    displaced = target;
    delete next.pieces[name];
    if (!target.setup) delete next.holders[target.userId];
    next.inventory[target.type] = (next.inventory[target.type] ?? 0) + 1;
  }
  // 2. Then take the new piece from stock.
  if ((next.inventory[type] ?? 0) <= 0) {
    return { ok: false, code: 'OUT_OF_STOCK', message: `No ${pieceName(type)}s left today. Try another piece.` };
  }
  next.inventory[type] = next.inventory[type]! - 1;
  // Moving or editing keeps your piece's identity; a fresh placement gets a new id.
  const piece: StoredPiece = {
    pieceId: own ? own.pieceId : newPieceId,
    socket: name,
    type,
    dir,
    userId: actor.userId,
    username: actor.username,
    placedAt: own ? own.placedAt : now,
  };
  if (own) piece.editedAt = now;
  if (displaced) piece.replaced = { userId: displaced.userId, username: displaced.username, type: displaced.type };
  next.pieces[name] = piece;
  next.holders[actor.userId] = name;

  const kind: ActionKind = displaced ? (own ? 'move-replace' : 'replace') : own ? (own.socket === name ? 'edit' : 'move') : 'place';
  const afterRun = ball1(level, next.pieces);
  const c = compareProgress(afterRun.progress, beforeRun.progress);
  const touched = afterRun.touchedPieceIds.includes(piece.pieceId) || (own ? beforeRun.touchedPieceIds.includes(own.pieceId) : false);
  const v = verdict(level, beforeRun, afterRun, touched || displaced !== undefined);
  if (displaced) {
    if (c <= 0) {
      const whose = displaced.setup ? 'the setup piece' : `u/${displaced.username}'s ${pieceName(displaced.type)}`;
      return { ok: false, code: 'MUST_IMPROVE', message: `To replace ${whose}, your version must give Ball 1 strictly better progress. ${v.reason}`, verdict: v };
    }
  } else if (c < 0) {
    return { ok: false, code: 'WOULD_HURT', message: `${v.label}: ${v.reason} Pieces can never lower Ball 1's progress.`, verdict: v };
  }
  const result: Decision = { ok: true, kind, next, piece, before: beforeRun.progress, after: afterRun.progress, raised: c > 0, verdict: v };
  if (own) result.own = own;
  if (displaced) result.displaced = displaced;
  return result;
}

/** Invariant (§2.3): every holder points at a piece they own, and every player piece has its holder. */
export function checkInvariant(s: BoardState): string | null {
  for (const [uid, sock] of Object.entries(s.holders)) {
    const p = s.pieces[sock];
    if (!p || p.userId !== uid) return `holder ${uid} → ${sock} has no matching piece`;
  }
  const seen = new Set<string>();
  for (const p of Object.values(s.pieces)) {
    if (p.setup) continue;
    if (seen.has(p.userId)) return `${p.userId} holds two pieces`;
    seen.add(p.userId);
    if (s.holders[p.userId] !== p.socket) return `${p.userId}'s piece at ${p.socket} has no holder entry`;
  }
  for (const v of Object.values(s.inventory)) if (v < 0) return 'negative inventory';
  return null;
}
