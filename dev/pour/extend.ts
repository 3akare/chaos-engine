/**
 * Add newly generated machines to the end of the daily pack, so the days after the current
 * pack get fresh machines instead of mirrored repeats. Existing machines keep their place, so
 * no day changes machine.
 *   npx tsx dev/pour/extend.ts <machines.jsonl> [how many]
 * Takes machines written by dev/pour/pack.ts, skips any already in the pack or used as a Solo
 * level, gives each a name no other machine has, fixes its goal at the generator's best score,
 * and alternates easier and harder ones. Run dev/pour/perfect.ts on the new indexes afterwards.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { ADJ, NOUN } from '../../src/shared/pour/generate';
import { LEVELS } from '../../src/shared/pour/levels';
import { hash32 } from '../../src/shared/rng';
import type { Machine } from '../../src/shared/pour/types';

const [, , src, count] = process.argv;
const pack = JSON.parse(readFileSync('src/shared/pour/pack.json', 'utf8')) as Machine[];
const seeds = new Set([...pack, ...LEVELS].map((m) => m.seed));
const names = new Set([...pack, ...LEVELS].map((m) => m.name));

const fresh = readFileSync(src!, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l) as Machine & { genSeed?: number })
  .filter((m) => m.gen && !seeds.has(m.seed) && (seeds.add(m.seed), true))
  .sort((a, b) => (a.genSeed ?? 0) - (b.genSeed ?? 0))
  .slice(0, count ? Number(count) : undefined);

// Easier and harder alternate, as in the first pack.
const byBest = [...fresh].sort((a, b) => (b.gen?.best ?? 0) - (a.gen?.best ?? 0) || a.seed - b.seed);
const order: typeof fresh = [];
for (let hi = 0, lo = byBest.length - 1; hi <= lo; ) {
  order.push(byBest[hi++]!);
  if (hi <= lo) order.push(byBest[lo--]!);
}

for (const { genSeed: _g, ...m } of order) {
  let name = m.name;
  for (let i = 0; names.has(name); i++) {
    const h = hash32(m.seed, i + 1);
    name = `${ADJ[h % ADJ.length]} ${NOUN[Math.floor(h / ADJ.length) % NOUN.length]}`;
  }
  names.add(name);
  pack.push({ ...m, name, gen: { ...m.gen!, goal: m.gen!.goal ?? m.gen!.best } });
}
writeFileSync('src/shared/pour/pack.json', JSON.stringify(pack) + '\n');
console.log(`Added ${order.length} machines; the pack now has ${pack.length} (days 1 to ${pack.length} before any repeat).`);
