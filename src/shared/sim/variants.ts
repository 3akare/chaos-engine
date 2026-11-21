import { Rng } from '../rng';
import type { SecretVariantId, VariantId } from '../types';

export type VariantInfo = { id: SecretVariantId; name: string; short: string; effect: string };

/** The public variant list (§4.6). Order is part of the seed contract — never reorder. */
export const VARIANTS: readonly VariantInfo[] = [
  { id: 'OFFSET_L', name: 'Drifter (left)', short: 'DRIFTER ◀', effect: 'Spawns one column left of Start.' },
  { id: 'OFFSET_R', name: 'Drifter (right)', short: 'DRIFTER ▶', effect: 'Spawns one column right of Start.' },
  { id: 'HEAVY', name: 'Heavy', short: 'HEAVY', effect: 'Fans reach only 1 cell; springs launch one cell lower.' },
  { id: 'BOUNCY', name: 'Bouncy', short: 'BOUNCY', effect: 'Bumpers hop one cell higher; springs launch one cell higher.' },
  { id: 'REVERSE', name: 'Contrarian', short: 'CONTRARIAN', effect: 'Starts rolling the opposite way.' },
  { id: 'SLICK', name: 'Slick', short: 'SLICK', effect: 'Ramps push it sideways only — no diagonal drop.' },
];

export const variantInfo = (id: VariantId): { name: string; short: string; effect: string } =>
  id === 'STANDARD'
    ? { name: 'Standard', short: 'STANDARD', effect: 'The ball you test with.' }
    : VARIANTS.find((v) => v.id === id)!;

/** Two distinct secret variants for a Day seed (§2.6). */
export function pickVariants(seed: number): [SecretVariantId, SecretVariantId] {
  const rng = new Rng(seed);
  const a = rng.int(VARIANTS.length);
  let b = rng.int(VARIANTS.length - 1);
  if (b >= a) b++;
  return [VARIANTS[a]!.id, VARIANTS[b]!.id];
}

/** Per-variant physics parameters. */
export type Physics = {
  fanRange: number;
  springUp: number;
  /** [up-diagonal steps, flat steps] for UL/UR springs. */
  arc: [number, number];
  hop: number;
  slick: boolean;
};

export function physicsFor(v: VariantId): Physics {
  const p: Physics = { fanRange: 3, springUp: 3, arc: [2, 2], hop: 1, slick: false };
  if (v === 'HEAVY') {
    p.fanRange = 1;
    p.springUp = 2;
    p.arc = [1, 3];
  } else if (v === 'BOUNCY') {
    p.springUp = 4;
    p.arc = [3, 1];
    p.hop = 2;
  } else if (v === 'SLICK') {
    p.slick = true;
  }
  return p;
}
