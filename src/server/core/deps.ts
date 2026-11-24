/**
 * Ports that the server core depends on. The Devvit entry wires these to the
 * real `redis` / `reddit` / `context`; the local harness and tests wire them to
 * in-memory fakes. Core code never imports `@devvit/web/server` directly.
 */

export type ZMember = { member: string; score: number };

/** Commands queued inside a MULTI. Mirrors the Devvit TxClient subset we use. */
export interface TxPort {
  multi(): Promise<void>;
  /** Resolves to the per-command results, or null if a watched key changed (aborted). */
  exec(): Promise<unknown[] | null>;
  discard(): Promise<void>;
  unwatch(): Promise<void>;
  set(key: string, value: string): Promise<void>;
  del(...keys: string[]): Promise<void>;
  hSet(key: string, fields: Record<string, string>): Promise<void>;
  hDel(key: string, fields: string[]): Promise<void>;
  hIncrBy(key: string, field: string, by: number): Promise<void>;
  zAdd(key: string, ...members: ZMember[]): Promise<void>;
  zIncrBy(key: string, member: string, by: number): Promise<void>;
}

/** The subset of Devvit Redis that the game uses. */
export interface StorePort {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string, opts?: { nx?: boolean; expiration?: Date }): Promise<void>;
  del(...keys: string[]): Promise<void>;
  hGet(key: string, field: string): Promise<string | undefined>;
  hGetAll(key: string): Promise<Record<string, string>>;
  hSet(key: string, fields: Record<string, string>): Promise<void>;
  hSetNX(key: string, field: string, value: string): Promise<boolean>;
  hDel(key: string, fields: string[]): Promise<void>;
  hIncrBy(key: string, field: string, by: number): Promise<number>;
  zAdd(key: string, ...members: ZMember[]): Promise<void>;
  zIncrBy(key: string, member: string, by: number): Promise<number>;
  zRange(key: string, start: number, stop: number, opts?: { reverse?: boolean; by?: 'rank' | 'score' }): Promise<ZMember[]>;
  zRem(key: string, members: string[]): Promise<void>;
  zCard(key: string): Promise<number>;
  /** Ascending rank (0 = lowest score), or undefined if absent. */
  zRank(key: string, member: string): Promise<number | undefined>;
  zScore(key: string, member: string): Promise<number | undefined>;
  watch(...keys: string[]): Promise<TxPort>;
}

export type RedditPostRef = { id: string; title: string; authorName: string; createdAt: number; url?: string };
export type RedditCommentRef = { id: string; body: string; authorName: string; createdAt: number };

/** The subset of the Reddit API that the game uses. */
export interface RedditPort {
  appUsername(): Promise<string>;
  submitDayPost(opts: { title: string; textFallback: string }): Promise<RedditPostRef>;
  submitResultsComment(postId: string, body: string): Promise<RedditCommentRef>;
  /** Newest posts in the subreddit (any author), newest first. */
  newPosts(limit: number): Promise<RedditPostRef[]>;
  /** Top-level comments on a post. */
  postComments(postId: string, limit: number): Promise<RedditCommentRef[]>;
  postUrl(postId: string): string;
}

export interface Deps {
  store: StorePort;
  reddit: RedditPort;
  /** Wall clock in ms. Injected so tests can control time. */
  now(): number;
  /** Cryptographically random bytes (secrets, salts, lease tokens). */
  randomBytes(n: number): Uint8Array;
  log(level: 'info' | 'warn' | 'error', msg: string, extra?: unknown): void;
}

/** Per-request identity. */
export type RequestCtx = {
  userId: string | undefined;
  username: string | undefined;
  postId: string | undefined;
  isMod: boolean;
};
