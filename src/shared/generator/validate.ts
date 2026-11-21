/** Machine validation (§5.3). Every published machine passes every check. */
import { idx, parseCell } from '../coords';
import { simulate } from '../sim/engine';
import { LevelError, parseLevel, type Level } from '../sim/level';
import { compareProgress, distanceField, UNREACHABLE } from '../sim/progress';
import { solutionPieces } from '../sim/board';
import { VARIANTS } from '../sim/variants';
import { H, PIECE_DIRS, PIECE_TYPES, W, type BoardPiece, type Machine, type SimResult } from '../types';

export type CheckId = 'structural' | 'broken' | 'interesting' | 'solvable' | 'buildable' | 'trivial' | 'headroom' | 'variety' | 'budget';

export type Validation = {
  ok: boolean;
  failed: CheckId | null;
  reason: string;
  sims: number;
  /** Variants (of 6) the stored solution delivers. */
  variantsDelivered: number;
  trivialFixes: number;
};

export const SIM_BUDGET = 5000;
export const MIN_INTERESTING_MOVES = 6;

/** Number of ticks in which the ball actually changed cell. */
export function movingTicks(r: SimResult): number {
  let n = 0;
  for (let i = 1; i < r.frames.length; i++) {
    const a = r.frames[i - 1]!;
    const b = r.frames[i]!;
    if (a.x !== b.x || a.y !== b.y) n++;
  }
  return n;
}

export type ValidateOptions = {
  tier: 1 | 2 | 3;
  /** Previous Days' family sequences and start columns, newest first (variety check). */
  history?: { families: string[]; startX: number }[];
  families?: string[];
  /** Sims already spent on this Day before validation (budget check). */
  simsSpent?: number;
};

const fail = (failed: CheckId, reason: string, sims: number, extra?: Partial<Validation>): Validation => ({
  ok: false,
  failed,
  reason,
  sims,
  variantsDelivered: 0,
  trivialFixes: 0,
  ...extra,
});

export function structuralCheck(m: Machine): { level: Level } | { error: string } {
  let level: Level;
  try {
    level = parseLevel(m);
  } catch (e) {
    return { error: e instanceof LevelError ? e.message : String(e) };
  }
  if (m.rows.length !== H || m.rows.some((r) => r.length !== W)) return { error: 'grid is not 9×14' };
  // Gate/switch rules (§4.10.6): every switch is linked, every linked gate is a gate, no shared cells (legend guarantees).
  for (let i = 0; i < W * H; i++) {
    if (level.kinds[i] === 'switch' && !level.links.has(i)) return { error: 'switch without linked gates' };
  }
  const field = distanceField(level);
  if (field[idx(level.start.x, level.start.y)] === UNREACHABLE) return { error: 'target unreachable from start' };
  if (level.objective.type === 'CHECKPOINTS_THEN_DELIVER') {
    if (level.checkpointCount !== level.objective.count || level.objective.count < 1) return { error: 'checkpoint count mismatch' };
    for (let n = 1; n <= level.checkpointCount; n++) if (!level.cp.includes(n)) return { error: `missing checkpoint ${n}` };
  } else if (level.checkpointCount > 0) {
    return { error: 'checkpoints on a DELIVER machine' };
  }
  const sol = m.solution ?? [];
  if (sol.length === 0) return { error: 'no stored solution' };
  const need: Record<string, number> = {};
  const seen = new Set<string>();
  for (const s of sol) {
    const c = parseCell(s.socket);
    if (!c || !level.socket[idx(c[0], c[1])]) return { error: `solution piece at ${s.socket} is not on a socket` };
    if (seen.has(s.socket)) return { error: `two solution pieces at ${s.socket}` };
    seen.add(s.socket);
    if (!PIECE_DIRS[s.type].includes(s.dir)) return { error: `bad orientation ${s.type}:${s.dir}` };
    need[s.type] = (need[s.type] ?? 0) + 1;
  }
  for (const [t, n] of Object.entries(need)) if ((m.inventory[t as keyof Machine['inventory']] ?? 0) < n) return { error: `inventory short of ${t}` };
  return { level };
}

function permutations<T>(arr: readonly T[]): T[][] {
  if (arr.length <= 1) return [arr.slice()];
  const out: T[][] = [];
  arr.forEach((x, i) => {
    for (const rest of permutations([...arr.slice(0, i), ...arr.slice(i + 1)])) out.push([x, ...rest]);
  });
  return out;
}

type Runner = (level: Level, pieces: readonly BoardPiece[], variant?: SimResult['variant']) => SimResult;
const plainRun: Runner = (level, pieces, variant) => simulate(level, pieces, variant ? { variant } : {});

/** Buildable under the rules: some placement order never lowers P (§5.3). */
export function isBuildable(level: Level, sol: readonly BoardPiece[], run: Runner = plainRun): boolean {
  const empty = run(level, []).progress;
  for (const order of permutations(sol)) {
    let prev = empty;
    let ok = true;
    for (let k = 1; k <= order.length && ok; k++) {
      const p = run(level, order.slice(0, k)).progress;
      if (compareProgress(p, prev) < 0) ok = false;
      prev = p;
    }
    if (ok) return true;
  }
  return false;
}

/** Single placements (socket × type × orientation, in stock) that deliver Ball 1 on their own. */
export function countTrivialFixes(level: Level, inventory: Machine['inventory'], run: Runner = plainRun): number {
  let n = 0;
  for (let i = 0; i < W * H; i++) {
    if (!level.socket[i]) continue;
    const x = i % W;
    const y = (i - x) / W;
    for (const t of PIECE_TYPES) {
      if ((inventory[t] ?? 0) <= 0) continue;
      for (const d of PIECE_DIRS[t]) if (run(level, [{ id: 'probe', type: t, dir: d, x, y }]).end === 'success') n++;
    }
  }
  return n;
}

export function countVariantsDelivered(level: Level, sol: readonly BoardPiece[], run: Runner = plainRun): number {
  let n = 0;
  for (const v of VARIANTS) if (run(level, sol, v.id).end === 'success') n++;
  return n;
}

export function varietyProblem(history: readonly { families: string[]; startX: number }[], families: readonly string[], startX: number): string | null {
  const fam = families.join('>');
  for (const h of history.slice(0, 2)) if (h.families.join('>') === fam) return 'same family sequence as a recent Day';
  if (history[0] && history[0].startX === startX) return 'same start column as yesterday';
  return null;
}

export function validateMachine(m: Machine, opts: ValidateOptions): Validation {
  let sims = opts.simsSpent ?? 0;
  const run: Runner = (level, pieces, variant) => {
    sims++;
    return plainRun(level, pieces, variant);
  };

  const st = structuralCheck(m);
  if ('error' in st) return fail('structural', st.error, sims);
  const level = st.level;

  const empty = run(level, []);
  if (empty.end === 'success') return fail('broken', 'Ball 1 delivers with no pieces', sims);
  if (movingTicks(empty) < MIN_INTERESTING_MOVES) return fail('interesting', `Ball 1 only moves ${movingTicks(empty)} ticks before ending`, sims);

  const sol = solutionPieces(m);
  const solved = run(level, sol);
  if (solved.end !== 'success') return fail('solvable', `stored solution ends with ${solved.end}`, sims);

  // Cheap checks first: headroom and variety before the permutation and single-piece sweeps.
  const delivered = countVariantsDelivered(level, sol, run);
  if (delivered < 1 || delivered > 4) return fail('headroom', `solution delivers ${delivered}/6 variants`, sims, { variantsDelivered: delivered });

  if (opts.history && opts.families) {
    const v = varietyProblem(opts.history, opts.families, level.start.x);
    if (v) return fail('variety', v, sims);
  }

  if (!isBuildable(level, sol, run)) return fail('buildable', 'no placement order keeps P from dropping', sims);

  const trivial = countTrivialFixes(level, m.inventory, run);
  const allowed = opts.tier === 1 ? 1 : 0;
  if (trivial > allowed) return fail('trivial', `${trivial} single-piece fixes (tier ${opts.tier} allows ${allowed})`, sims, { trivialFixes: trivial, variantsDelivered: delivered });

  if (sims > SIM_BUDGET) return fail('budget', `${sims} sims`, sims);

  return { ok: true, failed: null, reason: 'ok', sims, variantsDelivered: delivered, trivialFixes: trivial };
}
