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

const SAND: Palette = {
  floor: 0xfbf3e6,
  floorDot: 0xeadcc6,
  socket: 0xf0e3cd,
  socketEdge: 0xc9b597,
  wallTop: 0x8e9ac2,
  wallSide: 0x6b779f,
  shadow: 0x6b5233,
  shadowAlpha: 0.2,
  ink: 0x2b2d3a,
  ramp: 0x3d7ef0,
  rampSide: 0x2958b0,
  spring: 0xf39a3a,
  springSide: 0xc46f17,
  fan: 0x33b3a0,
  fanSide: 0x23857a,
  bumper: 0xef5a5f,
  bumperSide: 0xbd3b42,
  yellow: 0xf6c945,
  orange: 0xf28c28,
  blue: 0x3d7ef0,
  green: 0x2fa36b,
  red: 0xe5484d,
  white: 0xffffff,
  ball: 0x40475f,
  ballHi: 0xffffff,
  pathOld: 0xb9a888,
  pathNew: 0x3d7ef0,
  beam: 0x7fd3c6,
  gate: 0xf28c28,
  gateSide: 0xb8620f,
};

const NIGHT: Palette = {
  floor: 0x1e2648,
  floorDot: 0x2a3360,
  socket: 0x19203d,
  socketEdge: 0x5a66a3,
  wallTop: 0x5867ad,
  wallSide: 0x3b4682,
  shadow: 0x05081a,
  shadowAlpha: 0.45,
  ink: 0xe8ecff,
  ramp: 0x4f8dff,
  rampSide: 0x2f5fc2,
  spring: 0xffa64d,
  springSide: 0xc8741f,
  fan: 0x3fcab5,
  fanSide: 0x26907f,
  bumper: 0xff6b70,
  bumperSide: 0xc6434a,
  yellow: 0xffd45e,
  orange: 0xffa64d,
  blue: 0x4f8dff,
  green: 0x3cc982,
  red: 0xff6b70,
  white: 0xffffff,
  ball: 0xd9deef,
  ballHi: 0xffffff,
  pathOld: 0x56609a,
  pathNew: 0x7fb0ff,
  beam: 0x5ee0cc,
  gate: 0xffa64d,
  gateSide: 0xc8741f,
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
