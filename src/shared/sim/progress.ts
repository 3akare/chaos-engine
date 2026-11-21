import { idx } from '../coords';
import { H, W, type Progress } from '../types';
import type { Level } from './level';

export const UNREACHABLE = 999;
const cache = new WeakMap<Level, Int16Array>();

/**
 * 4-connected BFS distance from the Target over the level's FIXED geometry only (§4.7):
 * walls block, gates count as passable whatever their state, player pieces are ignored.
 */
export function distanceField(level: Level): Int16Array {
  const hit = cache.get(level);
  if (hit) return hit;
  const d = new Int16Array(W * H).fill(UNREACHABLE);
  const q: number[] = [];
  const t = idx(level.target.x, level.target.y);
  d[t] = 0;
  q.push(t);
  for (let head = 0; head < q.length; head++) {
    const i = q[head]!;
    const x = i % W;
    const y = (i - x) / W;
    const nd = d[i]! + 1;
    const nbrs: Array<[number, number]> = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ];
    for (const [nx, ny] of nbrs) {
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const j = idx(nx, ny);
      if (level.kinds[j] === 'solid' || d[j]! <= nd) continue;
      d[j] = nd;
      q.push(j);
    }
  }
  cache.set(level, d);
  return d;
}

/** Lexicographic compare: >0 if a is better than b. */
export function compareProgress(a: Progress, b: Progress): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}
