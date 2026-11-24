/**
 * The three hand-made levels from the prototype (the ones people played first), vetted the same
 * way as generated machines and appended to the pack.  npx tsx dev/pour/classics.ts [out.jsonl]
 */
import { appendFileSync } from 'node:fs';
import { GEN_VERSION } from '../../src/shared/pour/generate';
import { climb, median, vet } from '../../src/shared/pour/search';
import type { Machine } from '../../src/shared/pour/types';
import { Rng } from '../../src/shared/rng';

const CLASSICS: Machine[] = [
  {
    name: 'Detour', seed: 91, spawn: { x: 70, y: 18, vx: 1.2 }, bucket: { x: 292, y: 566, w: 72 },
    blocks: [{ x: 90, y: 122, w: 170, h: 18, a: 11 }, { x: 260, y: 150, w: 140, h: 18, a: -18 }, { x: 70, y: 300, w: 150, h: 18, a: 14 }, { x: 205, y: 395, w: 20, h: 150, a: 0 }, { x: 120, y: 470, w: 150, h: 18, a: -10 }],
    pegs: [[150, 220], [180, 245], [210, 220], [240, 245], [270, 220]], spinners: [], tools: { ramp: 2, spring: 1, bumper: 1, fan: 1 },
  },
  {
    name: 'The Gap', seed: 92, spawn: { x: 300, y: 18, vx: -1.2 }, bucket: { x: 60, y: 566, w: 72 },
    blocks: [{ x: 270, y: 110, w: 150, h: 18, a: -10 }, { x: 70, y: 190, w: 130, h: 18, a: 10 }, { x: 300, y: 300, w: 120, h: 18, a: -6 }, { x: 150, y: 380, w: 20, h: 120, a: 0 }, { x: 250, y: 470, w: 160, h: 18, a: 6 }],
    pegs: [[110, 270], [140, 290], [170, 270], [200, 290]], spinners: [{ x: 230, y: 210, len: 70, speed: 0.035 }], tools: { ramp: 2, spring: 1, bumper: 1, fan: 1 },
  },
  {
    name: 'Windmill', seed: 93, spawn: { x: 180, y: 18, vx: 0 }, bucket: { x: 180, y: 566, w: 64 },
    blocks: [{ x: 85, y: 150, w: 130, h: 18, a: 20 }, { x: 275, y: 150, w: 130, h: 18, a: -20 }, { x: 40, y: 330, w: 80, h: 18, a: -15 }, { x: 320, y: 330, w: 80, h: 18, a: 15 }, { x: 95, y: 470, w: 110, h: 18, a: 25 }, { x: 265, y: 470, w: 110, h: 18, a: -25 }],
    pegs: [[180, 120], [150, 380], [210, 380], [180, 420]], spinners: [{ x: 180, y: 250, len: 120, speed: 0.025 }], tools: { ramp: 2, spring: 1, bumper: 2, fan: 1 },
  },
];

const out = process.argv[2] ?? 'dev/pour/pack.jsonl';
for (const [i, m] of CLASSICS.entries()) {
  const v = vet(m, 500 + i, 10, 260)!;
  const more = climb(m, new Rng(900 + i), v.climb.build, 300);
  const best = more.best > v.climb.best ? more : v.climb;
  console.log(`${m.name}: empty ${v.empty} random ${median(v.random)} climb ${best.best}`);
  m.gen = { version: GEN_VERSION, best: best.best, random: median(v.random), par: best.build };
  appendFileSync(out, JSON.stringify({ genSeed: -1 - i, ...m }) + '\n');
}
