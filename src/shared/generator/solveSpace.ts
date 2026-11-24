/**
 * Solution-space census: try every arrangement of a machine's pieces (each piece on any + spot,
 * any turn, or left unused) and count how many get the normal ball home, and how many get all
 * three balls home. Used to reject days that are easy by luck, or where the extra balls don't matter.
 */
import { simulate } from '../sim/engine';
import type { Level } from '../sim/level';
import { PIECE_DIRS, W, type BoardPiece, type Machine, type PieceType } from '../types';

export type SolveSpace = { total: number; red: number; three: number; capped: boolean };

export function solveSpace(level: Level, inventory: Machine['inventory'], cap = 60000): SolveSpace {
  const sockets: number[] = [];
  for (let i = 0; i < level.socket.length; i++) if (level.socket[i]) sockets.push(i);
  const bag: PieceType[] = [];
  for (const [t, n] of Object.entries(inventory)) for (let k = 0; k < n; k++) bag.push(t as PieceType);
  let total = 0;
  let red = 0;
  let three = 0;
  const placed: BoardPiece[] = [];
  const used = new Set<number>();
  const rec = (k: number, minSock: number): void => {
    if (total >= cap) return;
    if (k === bag.length) {
      total++;
      if (simulate(level, placed).end !== 'success') return;
      red++;
      if (simulate(level, placed, { variant: 'HEAVY' }).end === 'success' && simulate(level, placed, { variant: 'BOUNCY' }).end === 'success') three++;
      return;
    }
    // Identical pieces are interchangeable: place them in increasing socket order.
    const same = k > 0 && bag[k] === bag[k - 1];
    rec(k + 1, 0);
    for (let si = same ? minSock : 0; si < sockets.length; si++) {
      const s = sockets[si]!;
      if (used.has(s)) continue;
      used.add(s);
      for (const d of PIECE_DIRS[bag[k]!]) {
        placed.push({ id: `p${k}`, type: bag[k]!, dir: d, x: s % W, y: Math.floor(s / W) });
        rec(k + 1, si + 1);
        placed.pop();
      }
      used.delete(s);
    }
  };
  rec(0, 0);
  return { total, red, three, capped: total >= cap };
}
