/**
 * The Chaos Engine simulation (§4). Pure, integer-only, deterministic.
 * One ball, one run. Every ball starts from the authored board (§4.10.2).
 */
import { idx } from '../coords';
import { H, W, type BoardPiece, type EndReason, type Frame, type Mode, type SimEvent, type SimResult, type VariantId } from '../types';
import type { Level } from './level';
import { distanceField } from './progress';
import { physicsFor } from './variants';

export const MAX_TICKS = 300;
const STALL_TICKS = 3;

export type SimOptions = {
  variant?: VariantId;
  maxTicks?: number;
};

type Step = [number, number];

const dirDx = (d: string): -1 | 1 => (d === 'L' || d === 'DL' || d === 'UL' ? -1 : 1);

export function simulate(level: Level, pieces: readonly BoardPiece[], opts: SimOptions = {}): SimResult {
  const variant = opts.variant ?? 'STANDARD';
  const maxTicks = opts.maxTicks ?? MAX_TICKS;
  const phys = physicsFor(variant);
  const field = distanceField(level);

  const pieceAt: (BoardPiece | undefined)[] = new Array<BoardPiece | undefined>(W * H);
  for (const p of pieces) pieceAt[idx(p.x, p.y)] = p;

  // Dynamic per-run state (§4.10.2–4).
  const gateOpen = level.gateOpen.slice();
  const gateCells: number[] = [];
  level.kinds.forEach((k, i) => {
    if (k === 'gate') gateCells.push(i);
  });
  const fired = new Set<number>();
  let cpNext = 1;

  const frames: Frame[] = [];
  const events: SimEvent[] = [];
  const touched: string[] = [];
  const touchedSet = new Set<string>();
  let prevContacts = new Set<string>();
  let contacts = new Set<string>();

  let tick = 0;
  let end: EndReason | null = null;
  let minDist = 999;

  const inGrid = (x: number, y: number): boolean => x >= 0 && x < W && y >= 0 && y < H;
  const solid = (x: number, y: number): boolean => {
    const i = idx(x, y);
    const k = level.kinds[i];
    if (k === 'solid') return true;
    if (k === 'gate' && !gateOpen[i]) return true;
    const p = pieceAt[i];
    return p !== undefined && p.type !== 'RAMP';
  };
  /** Can the ball move into (x, y)? Off the sides/bottom is "free" (the void); the top edge is a ceiling. */
  const free = (x: number, y: number): boolean => {
    if (y < 0) return false;
    if (!inGrid(x, y)) return true;
    return !solid(x, y);
  };
  const piece = (x: number, y: number): BoardPiece | undefined => (inGrid(x, y) ? pieceAt[idx(x, y)] : undefined);

  const ev = (kind: SimEvent['kind'], x: number, y: number, extra?: { pieceId?: string; n?: number }): void => {
    const e: SimEvent = { tick, kind, cell: [x, y] };
    if (extra?.pieceId !== undefined) e.pieceId = extra.pieceId;
    if (extra?.n !== undefined) e.n = extra.n;
    events.push(e);
  };
  /** A piece interacted with the ball. Continuous contact (fan beam, resting on top) only counts once. */
  const touch = (p: BoardPiece, continuous: boolean): void => {
    contacts.add(p.id);
    if (continuous && prevContacts.has(p.id)) return;
    ev('touch', p.x, p.y, { pieceId: p.id });
    if (!touchedSet.has(p.id)) {
      touchedSet.add(p.id);
      touched.push(p.id);
    }
  };

  // ---- Ball state (§4.3) ----
  let sx = level.start.x;
  if (variant === 'OFFSET_L' || variant === 'OFFSET_R') {
    const cx = Math.min(W - 1, Math.max(0, sx + (variant === 'OFFSET_L' ? -1 : 1)));
    if (!solid(cx, level.start.y)) sx = cx; // §4.10.12
  }
  let x = sx;
  let y = level.start.y;
  let dx: number = variant === 'REVERSE' ? -level.start.dx : level.start.dx;
  let mode: Mode = 'fall';
  let fly: Step[] = [];
  let stall = 0;
  let lastX = x;
  let lastY = y;
  let moved = false; // eslint-disable-line no-useless-assignment
  let acted = false; // eslint-disable-line no-useless-assignment

  const enter = (): void => {
    const i = idx(x, y);
    minDist = Math.min(minDist, field[i]!);
    const p = pieceAt[i];
    if (p && p.type === 'RAMP') {
      dx = dirDx(p.dir);
      touch(p, false);
      ev('deflect', x, y, { pieceId: p.id });
    }
    const k = level.kinds[i];
    if (k === 'switch' && !fired.has(i)) {
      fired.add(i);
      ev('switch', x, y);
      for (const g of level.links.get(i) ?? []) {
        gateOpen[g] = !gateOpen[g];
        ev('gate', g % W, Math.floor(g / W), { n: gateOpen[g] ? 1 : 0 });
      }
    } else if (k === 'checkpoint') {
      if (level.cp[i] === cpNext) {
        ev('checkpoint', x, y, { n: cpNext });
        cpNext++;
      }
    } else if (k === 'target') {
      const ok = level.objective.type === 'DELIVER' || cpNext - 1 >= level.objective.count;
      if (ok) end = 'success'; // §4.10.11; otherwise passable (§4.10.16)
    }
  };

  const moveTo = (nx: number, ny: number, m: Mode): void => {
    lastX = x;
    lastY = y;
    x = nx;
    y = ny;
    mode = m;
    moved = true;
    if (!inGrid(x, y)) {
      end = 'lost';
      return;
    }
    enter();
  };

  const launch = (p: BoardPiece): void => {
    const q: Step[] = [];
    if (p.dir === 'U') {
      for (let i = 0; i < phys.springUp; i++) q.push([0, -1]);
      if (dx !== 0) q.push([dx, 0]);
    } else {
      const s = dirDx(p.dir);
      for (let i = 0; i < phys.arc[0]; i++) q.push([s, -1]);
      for (let i = 0; i < phys.arc[1]; i++) q.push([s, 0]);
      dx = s;
    }
    fly = q;
    mode = 'fly';
    acted = true;
    touch(p, false);
    ev('launch', p.x, p.y, { pieceId: p.id });
  };

  const hopQueue = (d: number): Step[] => {
    const q: Step[] = [];
    for (let i = 0; i < phys.hop; i++) q.push([d, -1]);
    return q;
  };

  /** Ball moving horizontally (roll or flight) into bumper p (§4.10.8). */
  const bumpSide = (p: BoardPiece): void => {
    dx = -dx;
    touch(p, false);
    ev('deflect', p.x, p.y, { pieceId: p.id });
    acted = true;
    if (free(x + dx, y - 1)) {
      fly = hopQueue(dx);
      mode = 'fly';
    } else {
      fly = [];
      mode = 'roll';
    }
  };

  /** Ball on top of bumper p (§4.10.7). */
  const bumpTop = (p: BoardPiece): void => {
    const d = dirDx(p.dir);
    if (free(x + d, y - 1)) {
      fly = hopQueue(d);
    } else if (free(x + d, y)) {
      fly = [[d, 0]];
    } else {
      return; // boxed in: no hop, the stall counter runs
    }
    dx = d;
    mode = 'fly';
    acted = true;
    touch(p, false);
    ev('deflect', p.x, p.y, { pieceId: p.id });
  };

  /** Fan influence at the ball's cell (§4.10.9, §4.10.14). */
  const fanAt = (): { h: BoardPiece | undefined; u: BoardPiece | undefined; uDist: number } => {
    let h: BoardPiece | undefined;
    let hDist = 99;
    // Look left for an R fan, then right for an L fan; the beam stops at the first solid cell.
    for (const side of [-1, 1]) {
      for (let d = 1; d <= phys.fanRange; d++) {
        const cx = x + side * d;
        if (!inGrid(cx, y)) break;
        if (!solid(cx, y)) continue;
        const p = pieceAt[idx(cx, y)];
        if (p && p.type === 'FAN' && p.dir === (side < 0 ? 'R' : 'L')) {
          // Nearest wins; on a tie the lower x (the left fan) wins — same row, so y ties.
          if (d < hDist) {
            h = p;
            hDist = d;
          }
        }
        break;
      }
    }
    let u: BoardPiece | undefined;
    let uDist = 0;
    for (let d = 1; d <= phys.fanRange; d++) {
      const cy = y + d;
      if (cy >= H) break;
      if (!solid(x, cy)) continue;
      const p = pieceAt[idx(x, cy)];
      if (p && p.type === 'FAN' && p.dir === 'U') {
        u = p;
        uDist = d;
      }
      break;
    }
    return { h, u, uDist };
  };

  // Spawn.
  frames.push({ x, y, mode });
  enter();
  const seen = new Set<string>();

  while (end === null && tick < maxTicks) {
    tick++;
    moved = false;
    acted = false;
    prevContacts = contacts;
    contacts = new Set<string>();

    // `mode`/`end` are also mutated inside the helper closures above, which TS flow analysis can't see.
    if ((mode as Mode) === 'fly') {
      // 1. Fly (§4.5.1, §4.10.5)
      const step = fly.shift() ?? [0, 0];
      const nx = x + step[0];
      const ny = y + step[1];
      if (free(nx, ny)) {
        moveTo(nx, ny, 'fly');
      } else {
        const p = piece(nx, ny);
        fly = [];
        mode = 'fall';
        if (p && p.type === 'BUMPER' && step[0] !== 0) bumpSide(p);
      }
      if (end === null && (mode as Mode) === 'fly' && fly.length === 0) mode = 'fall';
    } else {
      // 2. Fans
      const { h, u, uDist } = fanAt();
      if (h) {
        dx = dirDx(h.dir);
        touch(h, true);
      }
      if (u) {
        // U beam: rise 1 per tick; at the top of the beam, slip out sideways (or hover).
        touch(u, true);
        const top = uDist >= phys.fanRange || !free(x, y - 1);
        if (!top) moveTo(x, y - 1, 'fall');
        else if (dx !== 0 && free(x + dx, y)) moveTo(x + dx, y, 'fall');
      } else if (piece(x, y)?.type === 'RAMP') {
        // Ramp: diagonal down if free, else sideways (§4.4). Slick balls only go sideways.
        if (!phys.slick && free(x + dx, y + 1)) moveTo(x + dx, y + 1, 'fall');
        else if (free(x + dx, y)) moveTo(x + dx, y, 'roll');
      } else if (free(x, y + 1)) {
        // 3. Fall (a horizontal beam blows an airborne ball sideways instead)
        if (h && free(x + dx, y)) moveTo(x + dx, y, 'fall');
        else moveTo(x, y + 1, 'fall');
      } else {
        // Landed / resting on a surface: fire its landing rule, else roll (§4.5.3–4).
        const below = piece(x, y + 1);
        if (below && below.type === 'SPRING') {
          launch(below);
        } else if (below && below.type === 'BUMPER') {
          bumpTop(below);
        } else {
          if (below) touch(below, true);
          mode = 'roll';
          if (dx !== 0) {
            const nx = x + dx;
            if (free(nx, y)) {
              moveTo(nx, y, 'roll');
            } else {
              const p = piece(nx, y);
              if (p && p.type === 'BUMPER') bumpSide(p);
              else dx = 0; // walls (and spring/fan sides, closed gates) stop the ball
            }
          }
        }
      }
    }

    if (end === null) {
      if (moved || acted) stall = 0;
      else stall++;
      if (stall >= STALL_TICKS) end = 'stalled';
    }
    frames.push({ x, y, mode });
    if (end === null && (moved || acted)) {
      const gates = gateCells.map((i) => (gateOpen[i] ? '1' : '0')).join('');
      const key = `${x},${y},${dx},${mode},${fly.map((s) => s.join(':')).join(';')},${[...fired].join('.')},${cpNext},${gates}`;
      if (seen.has(key)) end = 'loop';
      else seen.add(key);
    }
  }
  if (end === null) end = 'timeout';
  const endX = inGrid(x, y) ? x : lastX;
  const endY = inGrid(x, y) ? y : lastY;
  ev('end', endX, endY);

  const delivered = (end as EndReason) === 'success' ? 1 : 0;
  return {
    variant,
    end,
    ticks: tick,
    frames,
    events,
    progress: [delivered, cpNext - 1, -(delivered ? 0 : minDist)],
    touchedPieceIds: touched,
  };
}
