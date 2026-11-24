import { Rng } from '../rng';
import type { SecretVariantId, VariantId } from '../types';

export type VariantInfo = { id: SecretVariantId; name: string; short: string; effect: string };

/** The public variant list (§4.6). Order is part of the seed contract — never reorder. */
export const VARIANTS: readonly VariantInfo[] = [
  { id: 'OFFSET_L', name: 'Lefty', short: 'Lefty', effect: 'Starts one step left.' },
  { id: 'OFFSET_R', name: 'Righty', short: 'Righty', effect: 'Starts one step right.' },
  { id: 'HEAVY', name: 'Heavy', short: 'Heavy', effect: 'Hard to push or launch.' },
  { id: 'BOUNCY', name: 'Bouncy', short: 'Bouncy', effect: 'Springs fling it higher.' },
  { id: 'REVERSE', name: 'Backwards', short: 'Backwards', effect: 'Rolls the other way.' },
  { id: 'SLICK', name: 'Slick', short: 'Slick', effect: 'Slides over ramps.' },
];

export const variantInfo = (id: VariantId): { name: string; short: string; effect: string } =>
  id === 'STANDARD'
    ? { name: 'Red', short: 'Red', effect: 'The one you test with.' }
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
