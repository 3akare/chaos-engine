/** Pouring a machine many times: random builds, and a hill-climb towards the best build. */
import { Rng } from '../rng';
import { snap } from './build';
import { runPour, runPourDetail } from './sim';
import { type Machine, type Piece, PLACE, type Tool, TOOLS, TURN } from './types';

export function randomPiece(rng: Rng, type: Tool): Piece {
  const step = TURN[type];
  return snap({ type, x: rng.range(PLACE.minX + 18, PLACE.maxX - 18), y: rng.range(70, 540), a: step ? rng.int(360 / step) * step : 0 });
}

export function randomBuild(m: Machine, rng: Rng): Piece[] {
  const out: Piece[] = [];
  for (const t of TOOLS) for (let i = 0; i < (m.tools[t] ?? 0); i++) out.push(randomPiece(rng, t));
  return out;
}

function tweak(rng: Rng, build: Piece[]): Piece[] {
  const next = build.map((p) => ({ ...p }));
  const i = rng.int(next.length);
  const p = next[i]!;
  const r = rng.int(10);
  if (r < 5) {
    p.x += rng.range(-40, 40);
    p.y += rng.range(-40, 40);
  } else if (r < 8) p.a += (rng.chance(1, 2) ? 1 : -1) * (TURN[p.type] || 0);
  else next[i] = randomPiece(rng, p.type);
  next[i] = snap(next[i]!);
  return next;
}

export type Climb = { best: number; build: Piece[]; evals: number };

/** Caught balls, plus a little credit for near misses so the search has a slope to climb. */
const fitness = (m: Machine, b: Piece[]): [number, number] => {
  const r = runPourDetail(m, b);
  return [r.caught + r.near / 100, r.caught];
};

/** Keep any change that doesn't make the score worse. Stops early at 100. */
export function climb(m: Machine, rng: Rng, start: Piece[], iters: number): Climb {
  let build = start;
  let [fit, best] = fitness(m, build);
  let evals = 1;
  for (let i = 0; i < iters && best < 100; i++) {
    const next = tweak(rng, build);
    const [f, s] = fitness(m, next);
    evals++;
    if (f >= fit) {
      fit = f;
      best = s;
      build = next;
    }
  }
  return { best, build, evals };
}

export type Vetting = { empty: number; random: number[]; climb: Climb };

/** Empty board, `n` random builds, then a climb from the best random build. */
export function vet(m: Machine, seed: number, n = 10, iters = 220, reject?: (v: Partial<Vetting>) => boolean): Vetting | null {
  const rng = new Rng(seed);
  const empty = runPour(m, []);
  if (reject?.({ empty })) return null;
  const builds = Array.from({ length: n }, () => randomBuild(m, rng));
  const random = builds.map((b) => runPour(m, b));
  if (reject?.({ empty, random })) return null;
  let bi = 0;
  random.forEach((s, i) => {
    if (s > random[bi]!) bi = i;
  });
  return { empty, random, climb: climb(m, rng, builds[bi]!, iters) };
}

export const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
};
