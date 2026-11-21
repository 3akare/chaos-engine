/** Forward construction (§5.2): build the solved machine band by band, then break it. */
import { Rng } from '../rng';
import { simulate } from '../sim/engine';
import { H, W, type BoardPiece, type Machine, type PieceType } from '../types';
import { BUILDERS, FIX_FAMILIES, MAX_H, MIN_H, type Family } from './bands';
import { fixToPiece, fixToSolution, Grid, type Fix } from './grid';
import type { DayPlan } from './difficulty';
import { machineName } from './names';
import { MIN_INTERESTING_MOVES, movingTicks } from './validate';

export const BAND_ROWS = 12; // rows 0..11 hold the bands; rows 12–13 are the delivery tray
const BAND_TRIES = 20;
const BAND_TICKS = 60;

export type ConstructResult = { machine: Machine; sims: number } | { machine: null; sims: number; why: string };

type Slot = { family: Family; fix: boolean };

function pickFamilies(rng: Rng, plan: DayPlan): { bands: Slot[]; heights: number[]; finishFix: boolean } | null {
  const fixes = plan.tier + 1;
  // 3 bands + the finish tray = 4 slots.
  let fixSlots: boolean[];
  if (fixes >= 4) fixSlots = [true, true, true, true];
  else if (fixes === 3) fixSlots = rng.pick([[true, true, true, false], [true, false, true, true], [false, true, true, true], [true, true, false, true]]);
  else fixSlots = rng.pick([[true, false, true, false], [false, true, false, true], [true, false, false, true], [false, true, true, false]]);
  const wantGate = plan.gate === 'required' || (plan.gate === 'likely' && rng.chance(7, 10)) || (plan.gate === 'optional' && rng.chance(1, 4));
  const weights: Record<string, number> = plan.springFanWeighted ? { drop: 1, gap: 4, launch: 4, fan: 4 } : { drop: 3, gap: 2, launch: 2, fan: 2 };
  for (let tries = 0; tries < 30; tries++) {
    const bands: Slot[] = [];
    const fixBandIdx = [0, 1, 2].filter((i) => fixSlots[i]);
    const gateAt = wantGate && fixBandIdx.length > 0 ? rng.pick(fixBandIdx) : -1;
    let prev: Family | null = null;
    let ok = true;
    for (let i = 0; i < 3; i++) {
      let fam: Family;
      if (!fixSlots[i]) fam = 'funnel';
      else if (i === gateAt) fam = 'gate';
      else {
        const pool = FIX_FAMILIES.filter((f) => f !== 'gate' && f !== prev);
        let total = 0;
        for (const f of pool) total += weights[f] ?? 1;
        let r = rng.int(total);
        fam = pool[0]!;
        for (const f of pool) {
          r -= weights[f] ?? 1;
          if (r < 0) {
            fam = f;
            break;
          }
        }
      }
      if (fam === prev) ok = false;
      bands.push({ family: fam, fix: fixSlots[i]! });
      prev = fam;
    }
    if (!ok) continue;
    // Heights must sum to BAND_ROWS.
    const combos: number[][] = [];
    for (let a = MIN_H[bands[0]!.family]; a <= MAX_H[bands[0]!.family]; a++)
      for (let b = MIN_H[bands[1]!.family]; b <= MAX_H[bands[1]!.family]; b++) {
        const c = BAND_ROWS - a - b;
        if (c >= MIN_H[bands[2]!.family] && c <= MAX_H[bands[2]!.family]) combos.push([a, b, c]);
      }
    if (combos.length === 0) continue;
    return { bands, heights: rng.pick(combos), finishFix: fixSlots[3]! };
  }
  return null;
}

export function construct(seed: number, plan: DayPlan): ConstructResult {
  const rng = new Rng(seed);
  let sims = 0;
  const run = (g: Grid, dx: -1 | 0 | 1, pieces: BoardPiece[], stopAtRow?: number, maxTicks?: number) => {
    sims++;
    const o: { stopAtRow?: number; maxTicks?: number } = {};
    if (stopAtRow !== undefined) o.stopAtRow = stopAtRow;
    if (maxTicks !== undefined) o.maxTicks = maxTicks;
    return simulate(g.level(dx), pieces, o);
  };
  const fail = (why: string): ConstructResult => ({ machine: null, sims, why });

  const fam = pickFamilies(rng, plan);
  if (!fam) return fail('no family/height combination');

  // Start.
  const xs = [1, 2, 3, 4, 5, 6, 7].filter((x) => x !== plan.avoidStartX);
  const sx = rng.pick(xs);
  const first = fam.bands[0]!.family;
  const startDx: -1 | 0 | 1 = (first === 'fan' || first === 'drop') && rng.chance(1, 5) ? 0 : rng.int(2) === 0 ? -1 : 1;
  let grid = new Grid();
  grid.set(sx, 0, 'S');

  const fixes: Fix[] = [];
  const reserved = new Set<number>([sx]);
  const pathCells: number[] = [];
  let ex = sx;
  let edx: number = startDx;
  let entryTick = 0;
  let y0 = 0;
  const bandRows: Array<[number, number]> = [];

  for (let bi = 0; bi < 3; bi++) {
    const slot = fam.bands[bi]!;
    const h = fam.heights[bi]!;
    let accepted = false;
    // If the planned family can't fit at this entry, fall back to other fix families of the same height.
    const prevFam = bi > 0 ? fam.bands[bi - 1]!.family : null;
    const nextFam = bi < 2 ? fam.bands[bi + 1]!.family : null;
    const alts: Family[] = slot.fix
      ? [slot.family, ...rng.shuffle(FIX_FAMILIES.filter((f) => f !== slot.family && f !== prevFam && f !== nextFam && MIN_H[f] <= h && MAX_H[f] >= h && (f !== 'gate' || plan.gate !== 'optional')))]
      : [slot.family];
    for (let t = 0; t < BAND_TRIES * alts.length && !accepted; t++) {
      if (t > 0 && t % BAND_TRIES === 0) slot.family = alts[t / BAND_TRIES]!;
      const g2 = grid.clone();
      const plan2 = BUILDERS[slot.family]({ g: g2, rng, y0, h, ex, edx, reserved, start: { x: sx, y: 0 } });
      if (!plan2) continue;
      if (plan2.fixes.some((f) => g2.get(f.x, f.y) !== '.')) continue;
      const pieces = [...fixes, ...plan2.fixes].map(fixToPiece);
      const solved = run(g2, startDx, pieces, y0 + h, entryTick + BAND_TICKS);
      if (!solved.exit || solved.exit.y !== y0 + h || solved.exit.tick - entryTick > BAND_TICKS) continue;
      if (slot.fix) {
        const broken = run(g2, startDx, fixes.map(fixToPiece), y0 + h, entryTick + BAND_TICKS);
        if (broken.exit) continue; // the band must actually be broken without its fix
        // The first broken band decides how the empty machine fails: make it worth watching (§5.3).
        if (fixes.length === 0 && movingTicks(broken) < MIN_INTERESTING_MOVES) continue;
      }
      // Accept the band.
      grid = g2;
      fixes.push(...plan2.fixes);
      for (const f of plan2.fixes) reserved.add(f.y * W + f.x);
      for (const fr of solved.frames) {
        if (fr.x < 0 || fr.x >= W || fr.y < 0 || fr.y >= H) continue;
        reserved.add(fr.y * W + fr.x);
        pathCells.push(fr.y * W + fr.x);
      }
      ex = solved.exit.x;
      edx = solved.exit.dx;
      entryTick = solved.exit.tick;
      accepted = true;
    }
    if (!accepted) return fail(`band ${bi + 1} (${slot.family}) never exited cleanly`);
    bandRows.push([y0, y0 + h - 1]);
    y0 += h;
  }

  // Finish tray: floor on row 13, target on row 12 where the solved ball ends up.
  for (let x = 0; x < W; x++) grid.set(x, H - 1, '#');
  const ty = H - 2;
  let tx: number;
  if (fam.finishFix) {
    const d = edx !== 0 ? -edx : rng.int(2) === 0 ? -1 : 1;
    const k = rng.range(1, 3);
    tx = ex + d * k;
    if (tx < 0 || tx >= W) return fail('finish target off board');
    if (edx !== 0 && rng.chance(1, 2)) {
      const wx = ex - d * rng.range(1, 2);
      if (wx >= 0 && wx < W && grid.isEmpty(wx, ty)) grid.set(wx, ty, '#');
    }
    const useBumper = rng.chance(1, 4);
    fixes.push(useBumper ? { x: ex, y: ty, type: 'BUMPER', dir: d > 0 ? 'R' : 'L' } : { x: ex, y: ty, type: 'RAMP', dir: d > 0 ? 'DR' : 'DL' });
  } else {
    tx = edx === 0 ? ex : ex + edx * rng.range(1, 3);
    if (tx < 0 || tx >= W) tx = edx > 0 ? W - 1 : 0;
  }
  if (!grid.isEmpty(tx, ty)) return fail('target cell blocked');
  grid.set(tx, ty, 'T');

  const solPieces = fixes.map(fixToPiece);
  const solvedRun = run(grid, startDx, solPieces);
  if (solvedRun.end !== 'success') return fail(`solution ends ${solvedRun.end}`);
  if (fixes.some((f) => grid.get(f.x, f.y) !== '.')) return fail('solution cell not empty');

  // Checkpoints (Saturday): on the solved path, in path order, one per band.
  let objective: Machine['objective'] = { type: 'DELIVER' };
  if (plan.checkpoints > 0) {
    const want = plan.checkpoints;
    const bandsWithCells: number[][] = bandRows.map(([a, b]) => {
      const seen = new Set<number>();
      const out: number[] = [];
      for (const fr of solvedRun.frames) {
        if (fr.y < a || fr.y > b || fr.x < 0 || fr.x >= W) continue;
        const i = fr.y * W + fr.x;
        if (seen.has(i) || grid.get(fr.x, fr.y) !== '.' || fixes.some((f) => f.x === fr.x && f.y === fr.y)) continue;
        seen.add(i);
        out.push(i);
      }
      return out;
    });
    const usable = [0, 1, 2].filter((b) => bandsWithCells[b]!.length > 0);
    if (usable.length < want) return fail('not enough path for checkpoints');
    const chosenBands = rng.shuffle(usable).slice(0, want).sort((a, b) => a - b);
    let n = 1;
    for (const b of chosenBands) {
      const i = rng.pick(bandsWithCells[b]!);
      grid.set(i % W, Math.floor(i / W), String(n++));
    }
    objective = { type: 'CHECKPOINTS_THEN_DELIVER', count: want };
  }

  // Break it: solution cells become sockets, plus decoys near the path.
  for (const f of fixes) grid.set(f.x, f.y, 'o');
  const onPath = new Set(pathCells);
  for (const fr of solvedRun.frames) if (fr.x >= 0 && fr.x < W && fr.y >= 0 && fr.y < H) onPath.add(fr.y * W + fr.x);
  // The start's falling column (until the first landing) is off-limits for decoys.
  const startCol = new Set<number>();
  for (let y = 1; y < H && grid.get(sx, y) === '.'; y++) startCol.add(y * W + sx);
  const cand: number[] = [];
  for (let y = 0; y < H - 1; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (grid.get(x, y) !== '.' || onPath.has(i) || startCol.has(i)) continue;
      let near = false;
      for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2 && !near; dx++) if (onPath.has((y + dy) * W + (x + dx)) && x + dx >= 0 && x + dx < W) near = true;
      if (near) cand.push(i);
    }
  const [dlo, dhi] = plan.tier === 1 ? [6, 7] : plan.tier === 2 ? [7, 9] : [8, 10];
  const nDecoys = Math.min(cand.length, rng.range(dlo, dhi));
  for (const i of rng.shuffle(cand).slice(0, nDecoys)) grid.set(i % W, Math.floor(i / W), 'o');

  // Inventory = solution + tier extras.
  const inventory: Record<PieceType, number> = { RAMP: 0, SPRING: 0, FAN: 0, BUMPER: 0 };
  for (const f of fixes) inventory[f.type]++;
  for (const t of ['RAMP', 'SPRING', 'FAN', 'BUMPER'] as const) inventory[t] += plan.tier === 1 ? 1 : plan.tier === 2 ? rng.range(1, 2) : 2;

  const families = fam.bands.filter((b) => b.fix).map((b) => b.family as string);
  if (fam.finishFix) families.push('finish');
  const machine: Machine = {
    name: machineName(rng, families),
    objective,
    rows: grid.rows(),
    start: { dx: startDx },
    links: grid.links,
    inventory,
    target: rng.chance(1, 2) ? 'bell' : 'basket',
    solution: fixes.map(fixToSolution),
    gen: { baseSeed: 0, attempt: 0, version: 0, tier: plan.tier, families: fam.bands.map((b) => b.family as string).concat(fam.finishFix ? ['finish'] : []) },
  };
  return { machine, sims };
}
