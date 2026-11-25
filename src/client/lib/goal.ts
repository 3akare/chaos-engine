/**
 * The community goal as a compact strip: everyone's best pour today added up, against the four
 * tiers (Good, Great, Super, Extreme) sized to how many played. Used on the feed card and at the
 * top of the Daily screen, so the goal is visible before anyone plays. Styled by each page's CSS
 * under `.goal`.
 */
import type { Totals } from '../../shared/protocol';

const fmt = (n: number): string => n.toLocaleString('en-US');

function el(tag: string, cls: string, ...kids: Array<Node | string>): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  e.append(...kids);
  return e;
}

/** What the strip says, separate from the DOM so it can be tested. */
export function goalText(t: Totals, closed = false): { label: string; value: string; note: string } {
  const label = t.players ? `Together · ${fmt(t.players)} ${t.players === 1 ? 'player' : 'players'}` : 'Together';
  const value = t.tier ? `${fmt(t.balls)} · ${t.tier}` : fmt(t.balls);
  const next = t.tiers.find((tier) => t.balls < tier.need);
  const note = !t.players
    ? 'Everyone’s best pour adds up. Be the first!'
    : closed
      ? t.tier
        ? `Finished on ${t.tier}`
        : `Finished short of Good`
      : next
        ? `${fmt(next.need - t.balls)} more for ${next.name}`
        : 'Extreme! The best a day can be.';
  return { label, value, note };
}

export function goalStrip(t: Totals, closed = false): HTMLElement {
  const { label, value, note } = goalText(t, closed);
  const top = Math.max(1, t.tiers[t.tiers.length - 1]?.need ?? 1);
  const fill = el('span', 'gf');
  fill.style.width = t.players ? `${Math.min(100, (t.balls / top) * 100)}%` : '0%';
  const marks = t.tiers.map((tier) => {
    const m = el('span', `gm${t.players && t.balls >= tier.need ? ' hit' : ''}`);
    m.style.left = `${(tier.need / top) * 100}%`;
    return m;
  });
  return el(
    'div',
    `goal${t.tier ? ' full' : ''}`,
    el('div', 'gh', el('span', 'gl', label), el('b', 'gv', value)),
    el('div', 'gt', fill, ...marks),
    el('div', 'gn', note),
  );
}
