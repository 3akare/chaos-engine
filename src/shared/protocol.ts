/** Wire types shared by client and server. */
import type { Tier, TierName } from './goal';
import type { Machine, Piece } from './pour/types';

export type DayStatus = 'CREATING' | 'OPEN' | 'LOCKED' | 'RESOLVED' | 'COMMENTED' | 'HANDED_OFF';

/** A machine as clients see it (without the generator's own best build). */
export type PublicMachine = Omit<Machine, 'gen'>;

export type Entry = { rank: number; username: string; score: number; at: number };

/**
 * The day so far for the whole subreddit. `balls` adds up each player's best pour (at most 100
 * each); `tiers` are the goals for that many players, and `tier` the highest one reached.
 */
export type Totals = { players: number; pours: number; balls: number; hundreds: number; tiers: Tier[]; tier: TierName | null };

export type DayResult = {
  top: Entry[];
  /** Build of the Day: the top build, revealed once the day closes. */
  winner: { username: string; score: number; at: number; build: Piece[] } | null;
  totals: Totals;
  /** True when the day reached at least the first tier. */
  goalMet: boolean;
  /** Days in a row the subreddit hit its goal, after this one. */
  streak: number;
  lockedAt: number;
};

export type SubStats = { streak: number; bestStreak: number; goalDays: number; totalDays: number };
export type UserStats = { days: number; hundreds: number; wins: number; podiums: number };

export type DayView = {
  day: { dayId: string; dayNumber: number; status: DayStatus; openedAt: number; locksAt: number; postId: string | null; title: string };
  machine: PublicMachine;
  me: {
    userId: string | null;
    username: string | null;
    /** Your best score today and the build that got it. */
    best: number | null;
    build: Piece[] | null;
    rank: number | null;
    pours: number;
    stats: UserStats;
    /** Solo mode: best balls on each level (null = not played). */
    personal: (number | null)[];
  };
  /** Live top of today's leaderboard. */
  board: Entry[];
  totals: Totals;
  result: DayResult | null;
  sub: SubStats;
  /** The newest Day's post, for "Play today's machine". */
  current: { dayNumber: number; postId: string | null; url: string | null };
  yesterday: { dayNumber: number; winner: string | null; score: number } | null;
  /**
   * Once this day has closed: the best build known for its machine, to watch. Never sent while
   * the day is open.
   */
  solution: { build: Piece[]; score: number } | null;
  serverNow: number;
};

export type PourRequest = { postId?: string | undefined; build: Piece[]; claimed: number };
export type PourResult = {
  /** The official score (the server re-runs any pour that would raise your best). */
  score: number;
  best: number;
  improved: boolean;
  rank: number | null;
  board: Entry[];
  totals: Totals;
};

export type ErrorCode = 'LOCKED' | 'NOT_LOGGED_IN' | 'NO_DAY' | 'BUSY' | 'TOO_FAST' | 'BAD_REQUEST';
export type ApiError = { error: ErrorCode; message: string };

export type PersonalRequest = { level: number; claimed: number };
export type PersonalResult = { personal: (number | null)[] };
