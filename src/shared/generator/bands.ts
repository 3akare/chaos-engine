/**
 * Band families (§5.2). Each builder lays terrain for rows y0..y1 around the ball's entry
 * column and returns the band's solution piece(s). Builders are optimistic: construction
 * verifies every band with the real sim and re-rolls parameters when it doesn't work.
 */
import type { Rng } from '../rng';
import { W } from '../types';
import type { Fix, Grid } from './grid';

export type Family = 'drop' | 'gap' | 'gate' | 'launch' | 'fan' | 'funnel';
export const FIX_FAMILIES: readonly Family[] = ['drop', 'gap', 'gate', 'launch', 'fan'];

export type BandCtx = {
  g: Grid;
  rng: Rng;
  y0: number;
  h: number;
  /** Entry column and direction of the falling ball. */
  ex: number;
  edx: number;
  /** Cells the ball already used above this band (y*W+x); terrain must not cover them. */
  reserved: Set<number>;
  /** Cell that must stay clear (the Start). */
  start: { x: number; y: number };
};

export type BandPlan = { fixes: Fix[] };

const inX = (x: number): boolean => x >= 0 && x < W;

class Builder {
  ok = true;
  constructor(private c: BandCtx) {}
  wall(x: number, y: number): void {
    if (!inX(x)) return;
    const cur = this.c.g.get(x, y);
    if (cur === '#') return;
    if (cur !== '.' || this.c.reserved.has(y * W + x)) {
      this.ok = false;
      return;
    }
    this.c.g.set(x, y, '#');
  }
  span(xa: number, xb: number, y: number): void {
    for (let x = Math.min(xa, xb); x <= Math.max(xa, xb); x++) this.wall(x, y);
  }
  put(x: number, y: number, ch: string): void {
    if (!inX(x) || this.c.g.get(x, y) !== '.' || this.c.reserved.has(y * W + x)) {
      this.ok = false;
      return;
    }
    this.c.g.set(x, y, ch);
  }
  /** Require a cell to be empty (part of the intended route). */
  clear(x: number, y: number): void {
    const ch = this.c.g.get(x, y);
    if (!inX(x) || (ch !== '.' && ch !== 'S')) this.ok = false;
  }
}

const sign = (rng: Rng): number => (rng.int(2) === 0 ? -1 : 1);

/** Dead end on side `s` of the landing cell: a wall bump at distance m, or the ledge runs off the board edge. */
function deadEnd(b: Builder, c: BandCtx, s: number, yL: number, maxM = 3): void {
  if (c.rng.chance(1, 2)) {
    const edge = s < 0 ? 0 : W - 1;
    b.span(c.ex, edge, yL);
  } else {
    const m = c.rng.range(1, maxM);
    b.span(c.ex, c.ex + s * m, yL);
    b.wall(c.ex + s * m, yL - 1);
  }
}

// ---------------------------------------------------------------------------------------

/** Drop and redirect: the ball lands heading the wrong way. Fix: ramp, bumper or fan. */
export function buildDrop(c: BandCtx): BandPlan | null {
  const { rng, y0, h, ex } = c;
  const yL = y0 + h - 1;
  const d = c.edx !== 0 ? -c.edx : sign(rng);
  const k = rng.range(1, 3);
  const xe = ex + d * k;
  if (!inX(xe + d)) return null;
  const b = new Builder(c);
  b.span(ex, xe, yL);
  b.clear(xe + d, yL);
  for (let y = y0; y < yL; y++) b.clear(ex, y);
  const fixKind = rng.int(4); // 0,1 ramp · 2 bumper · 3 fan
  let fix: Fix;
  if (fixKind === 3) {
    const j = rng.range(1, 2);
    const fx = ex - d * j;
    if (!inX(fx)) return null;
    b.span(ex, fx, yL);
    b.wall(fx - d, yL - 1);
    fix = { x: fx, y: yL - 1, type: 'FAN', dir: d > 0 ? 'R' : 'L' };
  } else {
    deadEnd(b, c, -d, yL);
    if (fixKind === 2) {
      fix = { x: ex, y: yL - 1, type: 'BUMPER', dir: d > 0 ? 'R' : 'L' };
    } else {
      const lo = c.start.x === ex && c.start.y === y0 ? y0 + 1 : y0;
      if (lo > yL - 1) return null;
      fix = { x: ex, y: rng.range(lo, yL - 1), type: 'RAMP', dir: d > 0 ? 'DR' : 'DL' };
    }
  }
  return b.ok ? { fixes: [fix] } : null;
}

/** Gap: the ledge ends at a one-cell pit; a landing ledge sits across. Fix: spring arc or fan. */
export function buildGap(c: BandCtx): BandPlan | null {
  const { rng, y0, h, ex } = c;
  if (h < 5 || c.edx === 0) return null;
  const d = c.edx;
  const yL = y0 + 3;
  const y1 = y0 + h - 1;
  const useFan = rng.chance(1, 3);
  const k = useFan ? rng.range(0, 1) : rng.range(0, 1);
  const xe = ex + d * k;
  const xp = xe + d;
  // Spring arcs land 4 columns past the pit; fans blow the ball one column past it.
  const xa = useFan ? xp + d : xp + 4 * d;
  const L = useFan ? rng.range(2, 4) : rng.range(3, 5);
  const xl = xp + d * L;
  if (!inX(xa) || !inX(xp)) return null;
  const b = new Builder(c);
  for (let y = y0; y < yL; y++) b.clear(ex, y);
  b.span(ex, xe, yL);
  b.wall(xp, y1);
  const lastLedge = inX(xl) ? xl : d > 0 ? W - 1 : 0;
  b.span(xp + d, lastLedge, yL);
  if (inX(xl + d) && inX(xl)) {
    b.clear(xl + d, yL);
    b.clear(xl + d, y1);
  }
  for (let x = xp + d; x !== xa + d; x += d) for (let y = y0; y < yL; y++) b.clear(x, y);
  if (useFan) {
    const fx = ex - d;
    if (!inX(fx)) return null;
    b.wall(fx, yL);
    b.clear(fx, yL - 1);
    return b.ok ? { fixes: [{ x: fx, y: yL - 1, type: 'FAN', dir: d > 0 ? 'R' : 'L' }] } : null;
  }
  b.wall(ex - d, yL - 1);
  b.wall(ex - d, yL);
  return b.ok ? { fixes: [{ x: xp, y: yL, type: 'SPRING', dir: d > 0 ? 'UR' : 'UL' }] } : null;
}

/** Gate and switch: a closed gate blocks the ledge; the switch is off the natural path. Fix: ramp or bumper. */
export function buildGate(c: BandCtx): BandPlan | null {
  const { rng, y0, h, ex } = c;
  if (h < 4) return null;
  const yL = y0 + h - 1;
  const d = sign(rng);
  const useBumper = rng.chance(1, 4) && h >= 5;
  const ys = useBumper ? rng.range(y0 + 2, yL - 2) : rng.range(y0 + 1, yL - 2);
  const fy = ys - 1;
  if (c.start.x === ex && c.start.y === fy) return null;
  const j = rng.range(1, 2);
  const xg = ex + d * (1 + j);
  const e = rng.range(0, 2);
  const xe = xg + d * e;
  if (!inX(xe + d) || !inX(ex + d)) return null;
  const b = new Builder(c);
  for (let y = y0; y < yL; y++) b.clear(ex, y);
  for (let y = ys; y < yL; y++) b.clear(ex + d, y);
  b.put(ex + d, ys, 'w');
  b.span(ex, xe, yL);
  b.put(xg, yL - 1, 'G');
  b.clear(xe + d, yL);
  deadEnd(b, c, -d, yL, 2);
  if (!b.ok) return null;
  const name = (x: number, y: number): string => `${'ABCDEFGHI'[x]}${y + 1}`;
  c.g.links.push({ switch: name(ex + d, ys), gates: [name(xg, yL - 1)] });
  const fix: Fix = useBumper
    ? { x: ex, y: fy, type: 'BUMPER', dir: d > 0 ? 'R' : 'L' }
    : { x: ex, y: fy, type: 'RAMP', dir: d > 0 ? 'DR' : 'DL' };
  return { fixes: [fix] };
}

/** Launch pad: the way on is over a two-high wall. Fix: fan U or spring U in the pit before it. */
export function buildLaunch(c: BandCtx): BandPlan | null {
  const { rng, y0, h, ex } = c;
  if (h < 5 || c.edx === 0) return null;
  const d = c.edx;
  const yL = y0 + 3;
  const y1 = y0 + h - 1;
  const k = rng.range(1, 2);
  const xp = ex + d * k;
  const xt = xp + d;
  const xc = xt + d;
  if (!inX(xc)) return null;
  const b = new Builder(c);
  for (let y = y0; y < yL; y++) b.clear(ex, y);
  b.span(ex, xp - d, yL);
  b.wall(ex - d, yL - 1);
  b.wall(ex - d, yL);
  b.wall(xp, y1);
  b.wall(xt, yL - 2);
  b.wall(xt, yL - 1);
  b.wall(xt, yL);
  b.clear(xt, y0);
  for (let y = y0; y <= y1; y++) b.clear(xc, y);
  // A U spring needs four clear rows above the ball; near the top only the fan fits.
  const spring = yL - 4 >= 0 && c.g.isEmpty(xp, yL - 4) && c.g.isEmpty(xt, yL - 4) && rng.chance(1, 3);
  const fix: Fix = spring ? { x: xp, y: yL, type: 'SPRING', dir: 'U' } : { x: xp, y: yL, type: 'FAN', dir: 'U' };
  return b.ok ? { fixes: [fix] } : null;
}

/** Fan corridor: a low tunnel where the ball rolls into a dead end. Fix: a fan that blocks and blows it back. */
export function buildFan(c: BandCtx): BandPlan | null {
  const { rng, y0, h, ex } = c;
  const yL = y0 + h - 1;
  if (yL - 2 < y0) return null;
  const w = c.edx !== 0 ? c.edx : sign(rng);
  const d = -w;
  const m = rng.range(2, 3);
  const k = rng.range(1, 3);
  const xe = ex + d * k;
  const xw = ex + w * m;
  if (!inX(xe + d) || !inX(xw)) return null;
  const b = new Builder(c);
  for (let y = y0; y < yL; y++) b.clear(ex, y);
  b.span(xw, xe, yL);
  b.wall(xw, yL - 1);
  // Ceiling with an entry hole above the landing cell.
  for (let x = Math.min(xw, xe); x <= Math.max(xw, xe); x++) if (x !== ex) b.wall(x, yL - 2);
  b.clear(xe + d, yL);
  b.clear(xe + d, yL - 1);
  const j = rng.range(1, m - 1);
  return b.ok ? { fixes: [{ x: ex + w * j, y: yL - 1, type: 'FAN', dir: d > 0 ? 'R' : 'L' }] } : null;
}

/** Funnel: a connector with no fix. */
export function buildFunnel(c: BandCtx): BandPlan | null {
  const { rng, y0, h, ex } = c;
  const y1 = y0 + h - 1;
  const b = new Builder(c);
  if (c.edx !== 0) {
    const k = rng.range(1, 2);
    const xe = ex + c.edx * k;
    if (!inX(xe + c.edx)) return null;
    for (let y = y0; y < y1; y++) b.clear(ex, y);
    b.span(ex, xe, y1);
    b.wall(ex - c.edx, y1);
    b.wall(ex - c.edx, y1 - 1);
    b.clear(xe + c.edx, y1);
  } else {
    for (let y = y0; y <= y1; y++) b.clear(ex, y);
    for (let y = y0 + 1; y <= y1; y++) {
      b.wall(ex - 1, y);
      b.wall(ex + 1, y);
    }
  }
  return b.ok ? { fixes: [] } : null;
}

export const BUILDERS: Record<Family, (c: BandCtx) => BandPlan | null> = {
  drop: buildDrop,
  gap: buildGap,
  gate: buildGate,
  launch: buildLaunch,
  fan: buildFan,
  funnel: buildFunnel,
};

/** Smallest band height each family can use. */
export const MIN_H: Record<Family, number> = { drop: 3, gap: 5, gate: 4, launch: 5, fan: 3, funnel: 3 };
export const MAX_H: Record<Family, number> = { drop: 4, gap: 5, gate: 5, launch: 5, fan: 4, funnel: 3 };
