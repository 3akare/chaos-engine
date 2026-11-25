/**
 * The community goal box: everyone's best pour today added up (the fill), the next rating's
 * target, and a bar whose colour runs through the ball colours as it fills: red below Good,
 * then yellow (Good), green (Great), blue (Super), purple (Extreme), with a mark at each rating.
 * The ratings are sized to how many played. Used on the post and on the game's leaderboard and
 * closed-day cards. Styled by each page's CSS under `.goal`.
 */
import type { Tier, TierName } from '../../shared/goal';
import type { Totals } from '../../shared/protocol';

const fmt = (n: number): string => n.toLocaleString('en-US');

/** Each rating's colour: the game's ball colours, warm to cool. */
export const TIER_COLOR: Record<TierName | 'none', string> = {
  none: '#e54341',
  Good: '#ffc851',
  Great: '#2ecc71',
  Super: '#419fdd',
  Extreme: '#9b59b6',
};

function el(tag: string, cls: string, ...kids: Array<Node | string>): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  e.append(...kids);
  return e;
}

export type GoalText = {
  /** Balls caught together so far. */
  fill: string;
  /** The next rating's target ("/ 440"), or the top one once everything is reached; '' before anyone plays. */
  target: string;
  /** The rating reached, or what it says before one is. */
  badge: string;
  note: string;
};

/** What the box says, separate from the DOM so it can be tested. */
export function goalText(t: Totals, closed = false): GoalText {
  const players = `${fmt(t.players)} ${t.players === 1 ? 'player' : 'players'}`;
  if (!t.players) return { fill: '0', target: '', badge: closed ? 'No rating' : 'Today’s goal', note: closed ? 'Nobody poured on this one.' : 'Everyone’s best pour adds up. Be the first!' };
  const next = t.tiers.find((tier) => t.balls < tier.need);
  const top = t.tiers[t.tiers.length - 1];
  const target = `/ ${fmt((next ?? top)?.need ?? t.balls)}`;
  const badge = t.tier ?? (closed ? 'No rating' : 'No rating yet');
  const note = closed
    ? `${players} · ${t.tier ? `finished on ${t.tier}` : `finished short of ${t.tiers[0]?.name ?? 'Good'}`}`
    : next
      ? `${players} · ${fmt(next.need - t.balls)} more for ${next.name}`
      : `${players} · Extreme! The best a day can be.`;
  return { fill: fmt(t.balls), target, badge, note };
}

/** The bar's colours, with each rating's colour sitting at its mark. */
export function goalGradient(tiers: readonly Tier[]): string {
  const top = Math.max(1, tiers[tiers.length - 1]?.need ?? 1);
  const stops = [`${TIER_COLOR.none} 0%`, ...tiers.map((t) => `${TIER_COLOR[t.name]} ${Math.round((t.need / top) * 100)}%`)];
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

export function goalBox(t: Totals, closed = false): HTMLElement {
  const { fill, target, badge, note } = goalText(t, closed);
  const top = Math.max(1, t.tiers[t.tiers.length - 1]?.need ?? 1);
  const pct = t.players ? Math.min(100, (t.balls / top) * 100) : 0;
  const bar = el('div', 'gt');
  bar.style.backgroundImage = goalGradient(t.tiers);
  // The gradient is fixed to the whole bar; the unfilled part is covered, so the colour you
  // see at the end of the fill is the colour of how far the subreddit has got.
  const empty = el('span', 'ge');
  empty.style.left = `${pct}%`;
  bar.append(empty);
  for (const tier of t.tiers) {
    const m = el('span', `gm${t.players && t.balls >= tier.need ? ' hit' : ''}`);
    m.style.left = `${(tier.need / top) * 100}%`;
    bar.append(m);
  }
  const pill = el('span', `gb${t.tier ? ' on' : ''}`, badge);
  if (t.tier) pill.style.background = TIER_COLOR[t.tier];
  return el(
    'div',
    'goal',
    el('div', 'gh', el('span', 'gfill', el('b', 'gv', fill), target ? el('span', 'gtg', ` ${target}`) : ''), pill),
    bar,
    el('div', 'gn', note),
  );
}
