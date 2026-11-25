/** The ball-pour game: one machine a day, 100 balls, place pieces, catch as many as you can. */
export const W = 360;
export const H = 600;
export const BALLS = 100;
export const BALL_R = 6.5;

export const TOOLS = ['ramp', 'spring', 'bumper', 'fan'] as const;
export type Tool = (typeof TOOLS)[number];

/** A piece a player placed: centre in board units, angle in degrees. */
export type Piece = { type: Tool; x: number; y: number; a: number };

/** A grass platform (centre, size, tilt in degrees). */
export type Block = { x: number; y: number; w: number; h: number; a: number };
/** A plank that keeps turning about its centre (radians per step). */
export type Spinner = { x: number; y: number; len: number; speed: number };

export type Machine = {
  name: string;
  /** Seeds the chute's small wobble so the pour is the same for everyone today. */
  seed: number;
  spawn: { x: number; y: number; vx: number };
  bucket: { x: number; y: number; w: number };
  blocks: Block[];
  pegs: [number, number][];
  spinners: Spinner[];
  tools: Partial<Record<Tool, number>>;
  /** Generator notes: best score its own search found, and what random builds get. */
  gen?: {
    version: number;
    /** The best score the offline search has found; `par` is that build. */
    best: number;
    random: number;
    par?: Piece[];
    /** What the Daily goal is sized against. Set once, so a better build found later does not raise the goal. */
    goal?: number;
  };
};

/** How far a tap turns each piece. */
export const TURN: Record<Tool, number> = { ramp: 20, spring: 20, fan: 45, bumper: 0 };
export const TOOL_NAME: Record<Tool, string> = { ramp: 'Ramp', spring: 'Spring', bumper: 'Bumper', fan: 'Fan' };

/** Where a piece's centre may sit. */
export const PLACE = { minX: 12, maxX: W - 12, minY: 40, maxY: H - 30 } as const;
