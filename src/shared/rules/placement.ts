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
  /** userId → socket names they hold (derived from `pieces`; kept for the holder index). */
  holders: Record<string, string[]>;
};

export type Actor = { userId: string; username: string };

export type Action =
  /** `from`: which of your pieces to move here (needed when you hold several and are at your limit). */
  | { kind: 'set'; socket: string; type: PieceType; dir: Dir; from?: string | undefined }
  /** `socket`: which of your pieces to remove (optional if you hold exactly one). */
  | { kind: 'remove'; socket?: string | undefined };

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

/** Every player's sockets, derived from the pieces (setup pieces belong to nobody). */
export function holdersFrom(pieces: Record<string, StoredPiece>): Record<string, string[]> {
  const h: Record<string, string[]> = {};
  for (const p of Object.values(pieces)) if (!p.setup) (h[p.userId] ??= []).push(p.socket);
  for (const v of Object.values(h)) v.sort();
  return h;
}

/**
 * Solo and community modes in one rule: you may hold as many pieces as the fix needs,
 * shared between everyone building today (rounded up, at least one). Alone you can build
 * the whole fix; once enough people join, it is one piece each.
 */
export function allowanceFor(pieces: Record<string, StoredPiece>, userId: string, piecesNeeded: number): number {
  const builders = new Set(Object.values(pieces).filter((p) => !p.setup).map((p) => p.userId));
  builders.add(userId);
  return Math.max(1, Math.ceil(Math.max(1, piecesNeeded) / builders.size));
}

export type RuleOptions = { piecesNeeded: number };

/**
 * Decide an action. `newPieceId` and `now` are supplied by the caller so the function stays pure.
 * `level` must be the Day's parsed machine.
 */
export function decide(level: Level, state: BoardState, actor: Actor, action: Action, now: number, newPieceId: string, opts: RuleOptions = { piecesNeeded: 1 }): Decision {
  const mine = Object.values(state.pieces).filter((p) => p.userId === actor.userId && !p.setup);
  const allowance = allowanceFor(state.pieces, actor.userId, opts.piecesNeeded);
  const next: BoardState = { pieces: { ...state.pieces }, inventory: { ...state.inventory }, holders: {} };
  const beforeRun = ball1(level, state.pieces);
  const finish = (): void => {
    next.holders = holdersFrom(next.pieces);
  };

  if (action.kind === 'remove') {
    let own: StoredPiece | undefined;
    if (action.socket) {
      const p = state.pieces[action.socket];
      own = p && p.userId === actor.userId && !p.setup ? p : undefined;
      if (!own) return { ok: false, code: 'NO_PIECE', message: "That isn't one of your pieces." };
    } else if (mine.length === 1) own = mine[0];
    else if (mine.length === 0) return { ok: false, code: 'NO_PIECE', message: "You don't have a piece on the board." };
    else return { ok: false, code: 'BAD_REQUEST', message: 'Tap the piece you want to remove.' };
    delete next.pieces[own!.socket];
    next.inventory[own!.type] = (next.inventory[own!.type] ?? 0) + 1;
    finish();
    const afterRun = ball1(level, next.pieces);
    const v = verdict(level, beforeRun, afterRun, beforeRun.touchedPieceIds.includes(own!.pieceId));
    if (compareProgress(afterRun.progress, beforeRun.progress) < 0) {
      return { ok: false, code: 'WOULD_HURT', message: `Removing it would make things worse. ${v.reason}`, verdict: v };
    }
    return { ok: true, kind: 'remove', next, own: own!, before: beforeRun.progress, after: afterRun.progress, raised: false, verdict: v };
  }

  const { socket, type, dir } = action;
  if (!PIECE_DIRS[type]?.includes(dir)) return { ok: false, code: 'BAD_PIECE', message: "That piece can't face that way." };
  const cell = parseCell(socket);
  if (!cell) return { ok: false, code: 'NOT_A_SOCKET', message: "That spot isn't on the board." };
  const name = cellName(cell[0], cell[1]);
  const i = cell[1] * W + cell[0];
  if (!level.socket[i]) {
    const k = level.kinds[i];
    if (k !== 'empty') return { ok: false, code: 'NOT_REPLACEABLE', message: 'That part of the machine can’t be changed. Pieces go in the dashed squares.' };
    return { ok: false, code: 'NOT_A_SOCKET', message: 'Pieces only go in the dashed squares.' };
  }
  const target = state.pieces[name];
  const isOwnTarget = target !== undefined && target.userId === actor.userId && !target.setup;
  if (isOwnTarget && target.type === type && target.dir === dir) return { ok: false, code: 'NO_CHANGE', message: "That's already your piece." };

  // Which of your pieces (if any) this action moves or edits.
  let own: StoredPiece | undefined;
  if (isOwnTarget) own = target;
  else if (action.from && action.from !== name) {
    const p = state.pieces[action.from];
    if (!p || p.userId !== actor.userId || p.setup) return { ok: false, code: 'BAD_REQUEST', message: "That isn't one of your pieces." };
    own = p;
  } else if (mine.length >= allowance) {
    if (mine.length === 1) own = mine[0];
    else {
      return {
        ok: false,
        code: 'LIMIT',
        message: `You've used all ${allowance} of your pieces. Tap one of yours to move or remove it.`,
      };
    }
  }

  // 1. Return to stock every piece this action removes.
  if (own) {
    delete next.pieces[own.socket];
    next.inventory[own.type] = (next.inventory[own.type] ?? 0) + 1;
  }
  let displaced: StoredPiece | undefined;
  if (target && !isOwnTarget) {
    displaced = target;
    delete next.pieces[name];
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
  finish();

  const kind: ActionKind = displaced ? (own ? 'move-replace' : 'replace') : own ? (own.socket === name ? 'edit' : 'move') : 'place';
  const afterRun = ball1(level, next.pieces);
  const c = compareProgress(afterRun.progress, beforeRun.progress);
  const touched = afterRun.touchedPieceIds.includes(piece.pieceId) || (own ? beforeRun.touchedPieceIds.includes(own.pieceId) : false);
  const v = verdict(level, beforeRun, afterRun, touched || displaced !== undefined);
  if (displaced) {
    if (c <= 0) {
      const whose = displaced.setup ? 'the setup piece' : displaced.userId === actor.userId ? 'your own piece' : `u/${displaced.username}'s ${pieceName(displaced.type)}`;
      return { ok: false, code: 'MUST_IMPROVE', message: `To replace ${whose}, yours has to work better. ${v.reason}`, verdict: v };
    }
  } else if (c < 0) {
    return { ok: false, code: 'WOULD_HURT', message: `That would make things worse. ${v.reason}`, verdict: v };
  }
  const result: Decision = { ok: true, kind, next, piece, before: beforeRun.progress, after: afterRun.progress, raised: c > 0, verdict: v };
  if (own) result.own = own;
  if (displaced) result.displaced = displaced;
  return result;
}

/** Invariant (§2.3): the holder index and the pieces always agree; stock is never negative. */
export function checkInvariant(s: BoardState): string | null {
  const derived = holdersFrom(s.pieces);
  const a = JSON.stringify(Object.keys(derived).sort().map((k) => [k, derived[k]]));
  const b = JSON.stringify(Object.keys(s.holders).sort().map((k) => [k, [...s.holders[k]!].sort()]));
  if (a !== b) return `holder index ${b} disagrees with pieces ${a}`;
  for (const v of Object.values(s.inventory)) if (v < 0) return 'negative inventory';
  return null;
}
