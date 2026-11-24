/** Every Redis key in one place. Devvit Redis is installation-scoped, so no subreddit prefix. */
export const K = {
  cfg: 'ce:cfg',
  /** The machine for a day number, stored when it is first needed so it never changes after. */
  level: (dayNumber: number) => `ce:level:${dayNumber}`,
  dupes: 'ce:dupes',
  current: 'ce:day:current',
  meta: (dayId: string) => `ce:day:${dayId}:meta`,
  lock: 'ce:lock:daily',
  /** Leaderboard: zset userId → rank score (balls, then earliest). */
  board: (dayId: string) => `ce:day:${dayId}:board`,
  /** Each player's best: hash userId → JSON BestRec. */
  best: (dayId: string) => `ce:day:${dayId}:best`,
  /** Pours per player: hash userId → count. */
  pours: (dayId: string) => `ce:day:${dayId}:pours`,
  /** Subreddit totals for the day: hash balls / pours / hundreds. */
  totals: (dayId: string) => `ce:day:${dayId}:totals`,
  /** Short cooldown between submitted pours. */
  cool: (dayId: string, userId: string) => `ce:day:${dayId}:cool:${userId}`,
  result: (dayId: string) => `ce:day:${dayId}:result`,
  post: (postId: string) => `ce:post:${postId}`,
  dayByNumber: (n: number) => `ce:daynum:${n}`,
  userStats: (userId: string) => `ce:user:${userId}:stats`,
  sub: 'ce:sub:stats',
} as const;
