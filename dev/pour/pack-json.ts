/**
 * Turn the search's JSONL into the two sets of machines:
 * - src/shared/pour/personal.json: Personal mode's levels, in the order below (easy to hard);
 * - src/shared/pour/pack.json: Group mode's daily machines. Day 1 gets the friendliest one (highest
 *   search score); after that easier and harder alternate.
 * A machine is in one set only, so Personal never gives away a Group day.
 *   npx tsx dev/pour/pack-json.ts [dev/pour/pack.jsonl]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import type { Machine } from '../../src/shared/pour/types';

const src = process.argv[2] ?? 'dev/pour/pack.jsonl';
const rows = readFileSync(src, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l) as Machine & { genSeed?: number });
const seen = new Set<string>();
const uniq = rows.filter((m) => {
  const k = `${m.name}:${m.seed}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});
/** Personal levels by name, easy to hard. Three are the prototype's hand-made levels. */
const PERSONAL = ['Windmill', 'Jolly Gauntlet', 'Squeaky Funnel', 'Detour', 'Clumsy Ledge', 'Rowdy Waterfall', 'Dizzy Chute', 'The Gap'];
const personal = PERSONAL.map((n) => uniq.find((m) => m.name === n)).filter((m): m is (typeof uniq)[number] => !!m);
const daily = uniq.filter((m) => !PERSONAL.includes(m.name));
writeFileSync('src/shared/pour/personal.json', JSON.stringify(personal.map(({ genSeed: _g, ...m }) => m)) + '\n');
console.log(`Personal: ${personal.map((m) => `${m.name} (${m.gen?.best})`).join(', ')}`);

const byBest = [...daily].sort((a, b) => (b.gen?.best ?? 0) - (a.gen?.best ?? 0));
const order: typeof daily = [];
let lo = byBest.length - 1;
let hi = 0;
while (hi <= lo) {
  order.push(byBest[hi++]!);
  if (hi <= lo) order.push(byBest[lo--]!);
}
// Names must not repeat back to back.
const out = order.map(({ genSeed: _g, ...m }) => m);
writeFileSync('src/shared/pour/pack.json', JSON.stringify(out) + '\n');
console.log(`Group: ${out.length} machines: ${out.map((m) => `${m.name} (${m.gen?.best})`).join(', ')}`);
