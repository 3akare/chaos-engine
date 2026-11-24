/**
 * Turn the search's JSONL into src/shared/pour/pack.json, the order days are played in.
 * Day 1 gets the friendliest machine (highest search score); after that easier and harder alternate.
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
const byBest = [...uniq].sort((a, b) => (b.gen?.best ?? 0) - (a.gen?.best ?? 0));
const order: typeof uniq = [];
let lo = byBest.length - 1;
let hi = 0;
while (hi <= lo) {
  order.push(byBest[hi++]!);
  if (hi <= lo) order.push(byBest[lo--]!);
}
// Names must not repeat back to back.
const out = order.map(({ genSeed: _g, ...m }) => m);
writeFileSync('src/shared/pour/pack.json', JSON.stringify(out) + '\n');
console.log(`${out.length} machines: ${out.map((m) => `${m.name} (${m.gen?.best})`).join(', ')}`);
