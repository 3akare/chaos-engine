/**
 * Every Redis key in one place. Devvit Redis is installation-scoped, so no subreddit prefix.
 * "ce2:" because the first (grid) version of the game stored different data under "ce:"; an
 * install upgraded from it starts the ball-pour game fresh instead of reading the old records.
 */
export const K = {
  cfg: 'ce2:cfg',
  /** The machine for a day number, stored when it is first needed so it never changes after. */
  level: (dayNumber: number) => `ce2:level:${dayNumber}`,
  dupes: 'ce2:dupes',
  current: 'ce2:day:current',
  meta: (dayId: string) => `ce2:day:${dayId}:meta`,
  lock: 'ce2:lock:daily',
  /** Leaderboard: zset userId → rank score (balls, then earliest). */
  board: (dayId: string) => `ce2:day:${dayId}:board`,
  /** Each player's best: hash userId → JSON BestRec. */
  best: (dayId: string) => `ce2:day:${dayId}:best`,
  /** Pours per player: hash userId → count. */
  pours: (dayId: string) => `ce2:day:${dayId}:pours`,
  /** Subreddit totals for the day: hash balls / pours / hundreds. */
  totals: (dayId: string) => `ce2:day:${dayId}:totals`,
  /** Short cooldown between submitted pours. */
  cool: (dayId: string, userId: string) => `ce2:day:${dayId}:cool:${userId}`,
  result: (dayId: string) => `ce2:day:${dayId}:result`,
  /** A closed day's solution: the machine's best known build, poured once on that exact machine. */
  solution: (dayId: string) => `ce2:day:${dayId}:solution`,
  post: (postId: string) => `ce2:post:${postId}`,
  dayByNumber: (n: number) => `ce2:daynum:${n}`,
  userStats: (userId: string) => `ce2:user:${userId}:stats`,
  /** Solo mode: hash level index → best balls caught. */
  personal: (userId: string) => `ce2:user:${userId}:personal`,
  sub: 'ce2:sub:stats',
} as const;
