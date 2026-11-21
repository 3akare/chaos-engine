import { H, W } from './types';

const COLS = 'ABCDEFGHI';

/** (x, y) → "C7". Columns A–I left to right, rows 1–14 top to bottom. */
export function cellName(x: number, y: number): string {
  return `${COLS[x] ?? '?'}${y + 1}`;
}

/** "C7" → [x, y], or null if malformed / off-grid. */
export function parseCell(name: string): [number, number] | null {
  const m = /^([A-Ia-i])(\d{1,2})$/.exec(name.trim());
  if (!m) return null;
  const x = COLS.indexOf(m[1]!.toUpperCase());
  const y = Number(m[2]) - 1;
  if (x < 0 || x >= W || y < 0 || y >= H) return null;
  return [x, y];
}

export function inGrid(x: number, y: number): boolean {
  return x >= 0 && x < W && y >= 0 && y < H;
}

export const idx = (x: number, y: number): number => y * W + x;

const CIRCLED = ['⓪', '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'];
export const circled = (n: number): string => CIRCLED[n] ?? String(n);
