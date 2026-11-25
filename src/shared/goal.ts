/**
 * The subreddit's daily goal, sized to who actually played.
 *
 * Each player counts once, with their best pour of the day, so nobody can pump the total by
 * pouring again and again, and nobody is asked for more than 100. The bar for each tier is
 * "everyone who played averages this much", measured against the best score known for the
 * day's machine, so a hard machine asks for less than an easy one. One player alone can
 * reach every tier.
 */
export type TierName = 'Good' | 'Great' | 'Super' | 'Extreme';
export type Tier = { name: TierName; need: number };

/** Share of the machine's best known score each player needs to average. */
export const TIER_SHARE: readonly { name: TierName; share: number }[] = [
  { name: 'Good', share: 0.35 },
  { name: 'Great', share: 0.55 },
  { name: 'Super', share: 0.75 },
  { name: 'Extreme', share: 0.9 },
];

/** The ceiling used when a machine has no search notes. */
export const DEFAULT_CEILING = 80;

export function tiersFor(players: number, ceiling: number): Tier[] {
  const top = Math.max(1, Math.min(100, Math.round(ceiling)));
  // Round away float noise first (0.55 × 100 is 55.000…01), then round up to whole balls.
  return TIER_SHARE.map(({ name, share }) => ({ name, need: Math.max(1, Math.ceil(Math.round(players * top * share * 1000) / 1000)) }));
}

/** The highest tier the day's total has reached, or null. Nobody played: no tier. */
export function tierFor(total: number, players: number, tiers: readonly Tier[]): TierName | null {
  if (players === 0) return null;
  let reached: TierName | null = null;
  for (const t of tiers) if (total >= t.need) reached = t.name;
  return reached;
}
