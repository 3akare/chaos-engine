/**
 * Daily machine generator. Makes a candidate course from a seed; `search.ts` then pours it many
 * times and only keeps machines that random builds fail but a good build nearly clears.
 */
import { Rng } from '../rng';
import type { Block, Machine, Spinner, Tool } from './types';

export const GEN_VERSION = 1;

const ADJ = ['Wobbly', 'Rusty', 'Sneaky', 'Bouncy', 'Grumpy', 'Lucky', 'Dizzy', 'Crooked', 'Busy', 'Clumsy', 'Jolly', 'Tricky', 'Windy', 'Squeaky', 'Lazy', 'Rowdy'];
const NOUN = ['Detour', 'Funnel', 'Staircase', 'Switchback', 'Pinball', 'Windmill', 'Gauntlet', 'Zigzag', 'Shortcut', 'Waterfall', 'Maze', 'Drop', 'Ledge', 'Spiral', 'Gutter', 'Chute'];

type Box = { x: number; y: number; hw: number; hh: number };
const boxOf = (b: Block): Box => {
  const a = Math.abs((b.a * Math.PI) / 180);
  return { x: b.x, y: b.y, hw: (b.w / 2) * Math.cos(a) + (b.h / 2) * Math.sin(a), hh: (b.w / 2) * Math.sin(a) + (b.h / 2) * Math.cos(a) };
};
const hits = (a: Box, b: Box, gap: number): boolean => Math.abs(a.x - b.x) < a.hw + b.hw + gap && Math.abs(a.y - b.y) < a.hh + b.hh + gap;

/**
 * Six bands down the board. The first always catches the pour and tips it the wrong way; the rest
 * are ledges, a peg field, a spinner, a wall or a pair of short ledges, never overlapping.
 */
export function generateMachine(seed: number): Machine {
  const rng = new Rng(seed);
  const side = rng.pick(['L', 'C', 'R'] as const);
  const sx = side === 'L' ? rng.range(55, 100) : side === 'R' ? rng.range(260, 305) : rng.range(150, 210);
  const vx = side === 'L' ? 1.2 : side === 'R' ? -1.2 : rng.pick([-0.6, 0, 0.6]);
  const far = side === 'L' ? rng.range(250, 312) : side === 'R' ? rng.range(48, 110) : rng.pick([rng.range(48, 100), rng.range(260, 312)]);
  const bx = rng.chance(4, 5) || side === 'C' ? far : rng.range(150, 210);
  const bw = rng.range(62, 78);
  const bucket = { x: bx, y: 566, w: bw };
  /** Tilt (degrees, canvas sense) that rolls a ball on a ledge at x away from the bucket. */
  const away = (x: number, deg: number): number => (x < bx ? -deg : deg);

  const blocks: Block[] = [];
  const pegs: [number, number][] = [];
  const spinners: Spinner[] = [];
  const taken: Box[] = [
    { x: sx, y: 20, hw: 26, hh: 30 },
    { x: bx, y: 556, hw: bw / 2 + 14, hh: 40 },
  ];
  const free = (b: Box): boolean => b.x - b.hw > -8 && b.x + b.hw < 368 && taken.every((o) => !hits(o, b, 14));
  const addBlock = (b: Block): boolean => {
    const box = boxOf(b);
    if (!free(box)) return false;
    blocks.push(b);
    taken.push(box);
    return true;
  };

  // Band 0: a ledge under the chute that tips the pour away from the bucket.
  const w0 = rng.range(120, 170);
  addBlock({ x: Math.max(w0 / 2 - 4, Math.min(364 - w0 / 2, sx + (sx < bx ? 1 : -1) * rng.range(-10, 30))), y: rng.range(100, 125), w: w0, h: 18, a: away(sx, rng.range(9, 16)) });

  let usedPegs = false;
  let usedSpin = false;
  const ys = [190, 265, 340, 415, 488].map((y) => y + rng.range(-12, 12));
  for (const [i, y] of ys.entries()) {
    const roll = rng.int(100);
    if (roll < 14 && !usedPegs && i < 3) {
      usedPegs = true;
      const n = rng.range(4, 6);
      const x0 = rng.range(60, 300 - (n - 1) * 30);
      const box = { x: x0 + ((n - 1) * 30) / 2, y: y + 12, hw: ((n - 1) * 30) / 2 + 8, hh: 22 };
      if (free(box)) {
        for (let k = 0; k < n; k++) pegs.push([x0 + k * 30, y + (k % 2) * 25]);
        taken.push(box);
      }
    } else if (roll < 28 && !usedSpin && i < 4) {
      usedSpin = true;
      const len = rng.range(70, 120);
      const sp = { x: rng.range(70, 290), y, len, speed: (rng.pick([-1, 1]) * rng.range(20, 38)) / 1000 };
      const box = { x: sp.x, y, hw: len / 2 - 6, hh: len / 2 - 16 };
      if (free(box)) {
        spinners.push(sp);
        taken.push(box);
      }
    } else if (roll < 40 && i >= 2) {
      const x = Math.round((sx + bx) / 2) + rng.range(-40, 40);
      addBlock({ x, y: y + 20, w: 20, h: rng.range(90, 140), a: 0 });
    } else if (roll < 55) {
      const w = rng.range(70, 95);
      const x1 = rng.range(50, 150);
      addBlock({ x: x1, y, w, h: 18, a: rng.range(-20, 20) });
      addBlock({ x: x1 + rng.range(150, 200), y: y + rng.range(-15, 15), w, h: 18, a: rng.range(-20, 20) });
    } else {
      const w = rng.range(100, 170);
      for (let tries = 0; tries < 4; tries++) {
        const x = rng.range(Math.ceil(w / 2) - 4, 364 - Math.ceil(w / 2));
        const tilt = rng.chance(3, 5) ? away(x, rng.range(6, 20)) : rng.range(-20, 20);
        if (addBlock({ x, y, w, h: 18, a: tilt })) break;
      }
    }
  }

  const extras: Tool[] = rng.shuffle(['spring', 'bumper', 'fan', 'bumper', 'spring', 'fan'] as Tool[]).slice(0, rng.range(2, 3));
  const tools: Partial<Record<Tool, number>> = { ramp: rng.range(2, 3) };
  for (const t of extras) tools[t] = (tools[t] ?? 0) + 1;

  return {
    name: `${rng.pick(ADJ)} ${rng.pick(NOUN)}`,
    seed: rng.u32() || 1,
    spawn: { x: sx, y: 18, vx },
    bucket,
    blocks,
    pegs,
    spinners,
    tools,
  };
}
