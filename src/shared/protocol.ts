/** Wire types shared by client and server. Nothing here may contain a solution or an unrevealed secret. */
import type { Awards } from './awards';
import type { Dir, EndReason, Machine, PieceType, Progress, VariantId } from './types';

export type DayStatus = 'CREATING' | 'OPEN' | 'LOCKED' | 'RESOLVED' | 'COMMENTED' | 'HANDED_OFF';

/** A piece on the board, as stored and as sent to clients (§6.3). */
export type StoredPiece = {
  pieceId: string;
  socket: string;
  type: PieceType;
  dir: Dir;
  userId: string;
  username: string;
  placedAt: number;
  editedAt?: number;
  /** Set when this piece displaced someone else's. */
  replaced?: { userId: string; username: string; type: PieceType };
  /** Setup pieces (seed / demo tool) — labelled u/chaos-engine (setup), replaceable under the improve rule. */
  setup?: boolean;
};

/** Machine without its solution — the only form a client ever sees. */
export type PublicMachine = Omit<Machine, 'solution'>;

export type BallSummary = { variant: VariantId; end: EndReason; progress: Progress; ticks: number };

export type DayResult = {
  score: number;
  checkpoints: number;
  variants: [VariantId, VariantId, VariantId];
  perBall: [BallSummary, BallSummary, BallSummary];
  awards: Awards;
  revealedSecret: string;
  lockedAt: number;
  /** Prediction distribution at lock: index = predicted balls (0..3). */
  predictions: [number, number, number, number];
  builders: number;
  /** Community streak after this Day. */
  streak: number;
};

export type InboxItem = {
  id: string;
  at: number;
  kind: 'replaced' | 'removed' | 'mvp' | 'touched' | 'prediction';
  text: string;
  dayNumber: number;
};

export type SubStats = { streak: number; bestStreak: number; perfectDays: number; totalDays: number };
export type UserStats = { placed: number; touchedInFinal: number; mvps: number; predStreak: number; predBest: number };

export type DayView = {
  day: {
    dayId: string;
    dayNumber: number;
    status: DayStatus;
    openedAt: number;
    locksAt: number;
    commitHash: string;
    postId: string | null;
    title: string;
  };
  level: PublicMachine;
  pieces: StoredPiece[];
  inventory: Record<PieceType, number>;
  me: {
    userId: string | null;
    username: string | null;
    socket: string | null;
    prediction: number | null;
    inbox: InboxItem[];
    stats: UserStats;
  };
  counts: { builders: number; predictors: number; histogram: [number, number, number, number] | null };
  result: DayResult | null;
  sub: SubStats;
  /** The newest Day's post, for "Build today's machine →". */
  current: { dayNumber: number; postId: string | null; url: string | null };
  yesterday: { dayNumber: number; score: number } | null;
  serverNow: number;
};

export type PlaceRequest = { postId?: string; socketId: string; type: PieceType; dir: Dir };
export type PredictRequest = { postId?: string; balls: number };

export type ErrorCode =
  | 'LOCKED'
  | 'NOT_A_SOCKET'
  | 'NOT_REPLACEABLE'
  | 'WOULD_HURT'
  | 'MUST_IMPROVE'
  | 'OUT_OF_STOCK'
  | 'NO_PIECE'
  | 'BAD_PIECE'
  | 'NO_CHANGE'
  | 'NOT_LOGGED_IN'
  | 'NO_DAY'
  | 'BUSY'
  | 'BAD_REQUEST';

export type ApiError = { error: ErrorCode; message: string };
export type ApiOk<T> = T & { error?: undefined };
