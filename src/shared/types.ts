/** Core shared types. Pure data, no behaviour. */

export const GAME_NAME = 'Chaos Engine';
export const W = 9;
export const H = 14;

export type PieceType = 'RAMP' | 'SPRING' | 'FAN' | 'BUMPER';
export type Dir = 'DL' | 'DR' | 'U' | 'UL' | 'UR' | 'L' | 'R';

export const PIECE_TYPES: readonly PieceType[] = ['RAMP', 'SPRING', 'FAN', 'BUMPER'];
export const PIECE_DIRS: Readonly<Record<PieceType, readonly Dir[]>> = {
  RAMP: ['DR', 'DL'],
  SPRING: ['U', 'UR', 'UL'],
  FAN: ['R', 'L', 'U'],
  BUMPER: ['R', 'L'],
};

export type VariantId = 'STANDARD' | 'OFFSET_L' | 'OFFSET_R' | 'HEAVY' | 'BOUNCY' | 'REVERSE' | 'SLICK';
export type SecretVariantId = Exclude<VariantId, 'STANDARD'>;

export type Objective = { type: 'DELIVER' } | { type: 'CHECKPOINTS_THEN_DELIVER'; count: number };

export type SolutionPiece = { socket: string; type: PieceType; dir: Dir };

export type GenMeta = {
  baseSeed: number;
  attempt: number;
  version: number;
  tier: 1 | 2 | 3;
  families: string[];
  fallback?: boolean;
};

/** Machine JSON as stored (§5.1). `solution` is stripped before reaching any client. */
export type Machine = {
  name: string;
  objective: Objective;
  /** 14 rows × 9 chars. Legend: . empty  # solid  S start  T target  1-9 checkpoint  w switch  G gate(closed)  g gate(open)  o socket */
  rows: string[];
  start: { dx: -1 | 0 | 1 };
  links: { switch: string; gates: string[] }[];
  inventory: Record<PieceType, number>;
  target?: 'bell' | 'basket';
  solution?: SolutionPiece[];
  gen?: GenMeta;
};

/** A piece on the board as the sim sees it. */
export type BoardPiece = {
  id: string;
  type: PieceType;
  dir: Dir;
  x: number;
  y: number;
};

export type Mode = 'fall' | 'roll' | 'fly';
export type EndReason = 'success' | 'lost' | 'stalled' | 'loop' | 'timeout';
export type EventKind = 'touch' | 'launch' | 'deflect' | 'switch' | 'checkpoint' | 'gate' | 'end';

export type Frame = { x: number; y: number; mode: Mode };
export type SimEvent = {
  tick: number;
  kind: EventKind;
  cell: [number, number];
  pieceId?: string;
  /** checkpoint number, gate open state (1/0), etc. */
  n?: number;
};

/** [delivered 0|1, checkpointsHitInOrder, -minBfsDistanceToTarget] — compare lexicographically. */
export type Progress = [number, number, number];

export type SimResult = {
  variant: VariantId;
  end: EndReason;
  ticks: number;
  frames: Frame[];
  events: SimEvent[];
  progress: Progress;
  touchedPieceIds: string[];
};
