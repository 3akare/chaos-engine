/**
 * The daily machines, made and checked offline by dev/pour/pack.ts (each one: random builds
 * catch almost nothing, the search's best build nearly catches everything). After the pack runs
 * out it repeats mirrored, then with a fresh chute wobble, so no two days pour the same.
 */
import { hash32 } from '../rng';
import PACK_JSON from './pack.json';
import type { Machine, Piece } from './types';
import { W } from './types';

export const PACK = PACK_JSON as Machine[];

const mirrorPiece = (p: Piece): Piece => ({ ...p, x: W - p.x, a: p.type === 'fan' ? (540 - p.a) % 360 : (360 - p.a) % 360 });

export function mirror(m: Machine): Machine {
  return {
    ...m,
    spawn: { ...m.spawn, x: W - m.spawn.x, vx: -m.spawn.vx },
    bucket: { ...m.bucket, x: W - m.bucket.x },
    blocks: m.blocks.map((b) => ({ ...b, x: W - b.x, a: -b.a })),
    pegs: m.pegs.map(([x, y]) => [W - x, y] as [number, number]),
    spinners: m.spinners.map((s) => ({ ...s, x: W - s.x, speed: -s.speed })),
    ...(m.gen ? { gen: { ...m.gen, ...(m.gen.par ? { par: m.gen.par.map(mirrorPiece) } : {}) } } : {}),
  };
}

/** Day 1 is the pack's first machine. */
export function machineForDay(dayNumber: number): Machine {
  const n = PACK.length;
  const k = Math.max(0, dayNumber - 1);
  const base = PACK[k % n]!;
  const round = Math.floor(k / n);
  const m = round % 2 === 1 ? mirror(base) : { ...base };
  return round === 0 ? m : { ...m, seed: hash32(base.seed, round) || 1 };
}
