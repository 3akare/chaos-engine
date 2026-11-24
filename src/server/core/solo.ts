/**
 * Solo play: everyone gets their own copy of today's machine with the full set of pieces.
 * The client sends its arrangement; the server checks it, rolls the day's three balls and keeps
 * the player's best star count. Nothing here touches the shared (team) board.
 */
import { parseCell } from '../../shared/coords';
import type { SoloResult, SoloPiece } from '../../shared/protocol';
import { levelOf } from '../../shared/sim/board';
import { runBalls, DAY_BALLS } from '../../shared/sim/runDay';
import { PIECE_DIRS, PIECE_TYPES, W, type BoardPiece, type PieceType } from '../../shared/types';
import type { Deps } from './deps';
import { readMachine, readMeta } from './day';
import { K } from './keys';

export type SoloError = { error: 'NO_DAY' | 'BAD_PIECE'; message: string };

export async function soloStats(deps: Deps, dayId: string, userId: string | null): Promise<{ best: number | null; players: number; perfect: number }> {
  const all = await deps.store.hGetAll(K.solo(dayId));
  const vals = Object.values(all).map(Number);
  return { best: userId && all[userId] !== undefined ? Number(all[userId]) : null, players: vals.length, perfect: vals.filter((v) => v >= 3).length };
}

export async function playSolo(deps: Deps, dayId: string, userId: string | null, pieces: readonly SoloPiece[]): Promise<SoloResult | SoloError> {
  const meta = await readMeta(deps.store, dayId);
  const machine = meta ? await readMachine(deps.store, meta.dayNumber) : null;
  if (!meta || !machine) return { error: 'NO_DAY', message: 'No machine is running here yet.' };
  const level = levelOf(machine);
  const used: Record<PieceType, number> = { RAMP: 0, SPRING: 0, FAN: 0, BUMPER: 0 };
  const seen = new Set<string>();
  const board: BoardPiece[] = [];
  for (const [i, p] of pieces.entries()) {
    const c = parseCell(p.socket);
    if (!c || !PIECE_TYPES.includes(p.type) || !PIECE_DIRS[p.type].includes(p.dir)) return { error: 'BAD_PIECE', message: "That piece isn't valid." };
    if (!level.socket[c[1] * W + c[0]] || seen.has(p.socket)) return { error: 'BAD_PIECE', message: 'Pieces only go on the + spots, one each.' };
    seen.add(p.socket);
    used[p.type]++;
    if (used[p.type] > (machine.inventory[p.type] ?? 0)) return { error: 'BAD_PIECE', message: 'That’s more pieces than today’s machine has.' };
    board.push({ id: `solo${i}`, type: p.type, dir: p.dir, x: c[0], y: c[1] });
  }
  const run = runBalls({ level, pieces: board }, DAY_BALLS);
  const stars = run.score;
  if (userId) {
    const prev = await deps.store.hGet(K.solo(dayId), userId);
    if (prev === undefined || prev === null || stars > Number(prev)) await deps.store.hSet(K.solo(dayId), { [userId]: String(stars) });
  }
  const s = await soloStats(deps, dayId, userId);
  return { stars, perBall: run.balls.map((b) => b.end) as SoloResult['perBall'], best: s.best ?? stars, players: s.players, perfect: s.perfect };
}
