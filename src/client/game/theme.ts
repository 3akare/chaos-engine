/** Visual tokens for the workshop look (§7.4). Hex numbers for Phaser, strings for DOM/canvas. */
export const C = {
  board: 0xf6eedf,
  boardEdge: 0xe2d5bd,
  dot: 0xe4d8c2,
  ink: 0x2b2d3a,
  wall: 0x3c4159,
  wallTop: 0x52587a,
  socket: 0xb3a387,
  blue: 0x2f6fdb,
  blueDark: 0x1f4fa8,
  orange: 0xf28c28,
  orangeDark: 0xc96a10,
  yellow: 0xf6c945,
  red: 0xe5484d,
  green: 0x2fa36b,
  white: 0xffffff,
  ball: 0x3a4157,
  ballHi: 0xdfe6f5,
  ghostOld: 0x9a8f7c,
  ghostNew: 0x2f6fdb,
  beam: 0x8fb4f0,
  label: 0x8b7f6a,
} as const;

export const css = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

export const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Base tick duration at 1× (§7.5). */
export const TICK_MS = 120;
