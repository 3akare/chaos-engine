/** Checking a submitted build: right pieces, right counts, on the board, sensible angles. */
import { type Machine, type Piece, PLACE, type Tool, TOOLS, TURN } from './types';

export const MAX_PIECES = 10;

const isTool = (t: unknown): t is Tool => typeof t === 'string' && (TOOLS as readonly string[]).includes(t);

/** Normalise a piece the way the client stores it: whole-number position, angle on the tool's step. */
export function snap(p: Piece): Piece {
  const step = TURN[p.type];
  const a = step ? ((((Math.round(p.a / step) * step) % 360) + 360) % 360) : 0;
  return {
    type: p.type,
    x: Math.max(PLACE.minX, Math.min(PLACE.maxX, Math.round(p.x))),
    y: Math.max(PLACE.minY, Math.min(PLACE.maxY, Math.round(p.y))),
    a,
  };
}

/** A valid build for this machine, or null. Never trusts the client: snaps and counts everything. */
export function cleanBuild(machine: Machine, raw: unknown): Piece[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_PIECES) return null;
  const used: Partial<Record<Tool, number>> = {};
  const out: Piece[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') return null;
    const { type, x, y, a } = r as Record<string, unknown>;
    if (!isTool(type) || typeof x !== 'number' || typeof y !== 'number' || typeof a !== 'number') return null;
    if (![x, y, a].every(Number.isFinite)) return null;
    used[type] = (used[type] ?? 0) + 1;
    if (used[type]! > (machine.tools[type] ?? 0)) return null;
    out.push(snap({ type, x, y, a }));
  }
  return out;
}

/** Short stable text form of a build (for storing and comparing). */
export const buildKey = (pieces: readonly Piece[]): string => JSON.stringify(pieces.map((p) => [p.type, p.x, p.y, p.a]));

export function parseBuildKey(s: string): Piece[] {
  return (JSON.parse(s) as [Tool, number, number, number][]).map(([type, x, y, a]) => ({ type, x, y, a }));
}
