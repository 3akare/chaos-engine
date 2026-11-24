/**
 * Visual tokens. Two palettes: "sand" (light, Mini Motorways-like tabletop) and
 * "night" (dark, deep indigo). `C` is mutable so every drawing call follows the theme.
 */
export type Palette = {
  floor: number;
  floorDot: number;
  socket: number;
  socketEdge: number;
  wallTop: number;
  wallSide: number;
  shadow: number;
  shadowAlpha: number;
  ink: number;
  ramp: number;
  rampSide: number;
  spring: number;
  springSide: number;
  fan: number;
  fanSide: number;
  bumper: number;
  bumperSide: number;
  yellow: number;
  orange: number;
  blue: number;
  green: number;
  red: number;
  white: number;
  ball: number;
  ballHi: number;
  pathOld: number;
  pathNew: number;
  beam: number;
  gate: number;
  gateSide: number;
};

/** Clay, daylight: cream floor, white clay blocks, peach shadows. */
const SAND: Palette = {
  floor: 0xfff4ea,
  floorDot: 0xf6dfcf,
  socket: 0xf1c8b4,
  socketEdge: 0xe3a98f,
  wallTop: 0xffffff,
  wallSide: 0xf1cdbb,
  shadow: 0xb0624a,
  shadowAlpha: 0.2,
  ink: 0x5a3442,
  ramp: 0x7ab8ff,
  rampSide: 0x4f8fe0,
  spring: 0xffc95e,
  springSide: 0xe0a033,
  fan: 0x7fd6a0,
  fanSide: 0x4fb07a,
  bumper: 0xff8f8f,
  bumperSide: 0xe0606b,
  yellow: 0xffc95e,
  orange: 0xff9a6b,
  blue: 0x7ab8ff,
  green: 0x5cc98a,
  red: 0xff6b6b,
  white: 0xffffff,
  ball: 0xff7b5c,
  ballHi: 0xffffff,
  pathOld: 0xe9b9a5,
  pathNew: 0xff7b5c,
  beam: 0xa8ecc1,
  gate: 0xff9a6b,
  gateSide: 0xd8704a,
};

/** Clay, dusk: plum floor, warm cream blocks. */
const NIGHT: Palette = {
  floor: 0x3a2a4a,
  floorDot: 0x46345a,
  socket: 0x4b3860,
  socketEdge: 0x8d6f9e,
  wallTop: 0xf3d9c4,
  wallSide: 0xc99f86,
  shadow: 0x140a1e,
  shadowAlpha: 0.38,
  ink: 0xfbe9dc,
  ramp: 0x8ec4ff,
  rampSide: 0x5b95e0,
  spring: 0xffd27a,
  springSide: 0xdca744,
  fan: 0x8fe0b0,
  fanSide: 0x5cb684,
  bumper: 0xff9d9d,
  bumperSide: 0xe06d78,
  yellow: 0xffd27a,
  orange: 0xffa585,
  blue: 0x8ec4ff,
  green: 0x6fd69a,
  red: 0xff7b7b,
  white: 0xffffff,
  ball: 0xff8f6b,
  ballHi: 0xffffff,
  pathOld: 0x6b5480,
  pathNew: 0xff8f6b,
  beam: 0x8fe0b0,
  gate: 0xffa585,
  gateSide: 0xd47a5a,
};

export const C: Palette = { ...SAND };

export function isDark(): boolean {
  const t = document.documentElement.dataset.theme;
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
}

export function applyTheme(): void {
  Object.assign(C, isDark() ? NIGHT : SAND);
}

export const css = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

export const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Base tick duration at 1× (§7.5). */
export const TICK_MS = 110;
