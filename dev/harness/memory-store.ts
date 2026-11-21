/**
 * In-memory implementation of StorePort with real WATCH/MULTI/EXEC semantics:
 * every write bumps a per-key version; EXEC aborts (returns null) if any watched
 * key's version changed since WATCH. Used by the harness and the test suite.
 */
import type { StorePort, TxPort, ZMember } from '../../src/server/core/deps';

type Val =
  | { t: 'str'; v: string; exp?: number }
  | { t: 'hash'; v: Map<string, string> }
  | { t: 'zset'; v: Map<string, number> };

export class MemoryStore implements StorePort {
  private data = new Map<string, Val>();
  private versions = new Map<string, number>();
  /** Test hook: called before each EXEC commits, after the version check is armed. */
  beforeExec: (() => Promise<void>) | undefined;
  /** Test hook: throw from any command whose name matches. */
  failOn: ((cmd: string, key: string) => boolean) | undefined;

  constructor(private clock: () => number = () => Date.now()) {}

  private bump(key: string): void {
    this.versions.set(key, (this.versions.get(key) ?? 0) + 1);
  }
  private check(cmd: string, key: string): void {
    if (this.failOn?.(cmd, key)) throw new Error(`injected failure: ${cmd} ${key}`);
  }
  private live(key: string): Val | undefined {
    const v = this.data.get(key);
    if (v && v.t === 'str' && v.exp !== undefined && v.exp <= this.clock()) {
      this.data.delete(key);
      this.bump(key);
      return undefined;
    }
    return v;
  }
  private hash(key: string, create: boolean): Map<string, string> | undefined {
    const v = this.live(key);
    if (v?.t === 'hash') return v.v;
    if (v) throw new Error(`WRONGTYPE ${key}`);
    if (!create) return undefined;
    const m = new Map<string, string>();
    this.data.set(key, { t: 'hash', v: m });
    return m;
  }
  private zset(key: string, create: boolean): Map<string, number> | undefined {
    const v = this.live(key);
    if (v?.t === 'zset') return v.v;
    if (v) throw new Error(`WRONGTYPE ${key}`);
    if (!create) return undefined;
    const m = new Map<string, number>();
    this.data.set(key, { t: 'zset', v: m });
    return m;
  }

  /** Snapshot for debugging / harness reset. */
  keys(): string[] {
    return [...this.data.keys()].filter((k) => this.live(k));
  }
  flush(): void {
    for (const k of this.data.keys()) this.bump(k);
    this.data.clear();
  }

  async get(key: string): Promise<string | undefined> {
    this.check('get', key);
    const v = this.live(key);
    if (!v) return undefined;
    if (v.t !== 'str') throw new Error(`WRONGTYPE ${key}`);
    return v.v;
  }
  async set(key: string, value: string, opts?: { nx?: boolean; expiration?: Date }): Promise<void> {
    this.check('set', key);
    if (opts?.nx && this.live(key)) return;
    const exp = opts?.expiration ? opts.expiration.getTime() : undefined;
    this.data.set(key, exp === undefined ? { t: 'str', v: value } : { t: 'str', v: value, exp });
    this.bump(key);
  }
  async del(...keys: string[]): Promise<void> {
    for (const k of keys) {
      this.check('del', k);
      if (this.data.delete(k)) this.bump(k);
    }
  }
  async hGet(key: string, field: string): Promise<string | undefined> {
    this.check('hGet', key);
    return this.hash(key, false)?.get(field);
  }
  async hGetAll(key: string): Promise<Record<string, string>> {
    this.check('hGetAll', key);
    return Object.fromEntries(this.hash(key, false) ?? []);
  }
  async hSet(key: string, fields: Record<string, string>): Promise<void> {
    this.check('hSet', key);
    const h = this.hash(key, true)!;
    for (const [f, v] of Object.entries(fields)) h.set(f, v);
    this.bump(key);
  }
  async hSetNX(key: string, field: string, value: string): Promise<boolean> {
    this.check('hSetNX', key);
    const h = this.hash(key, true)!;
    if (h.has(field)) return false;
    h.set(field, value);
    this.bump(key);
    return true;
  }
  async hDel(key: string, fields: string[]): Promise<void> {
    this.check('hDel', key);
    const h = this.hash(key, false);
    if (!h) return;
    for (const f of fields) h.delete(f);
    if (h.size === 0) this.data.delete(key);
    this.bump(key);
  }
  async hIncrBy(key: string, field: string, by: number): Promise<number> {
    this.check('hIncrBy', key);
    const h = this.hash(key, true)!;
    const n = Number(h.get(field) ?? '0') + by;
    h.set(field, String(n));
    this.bump(key);
    return n;
  }
  async zAdd(key: string, ...members: ZMember[]): Promise<void> {
    this.check('zAdd', key);
    const z = this.zset(key, true)!;
    for (const m of members) z.set(m.member, m.score);
    this.bump(key);
  }
  async zIncrBy(key: string, member: string, by: number): Promise<number> {
    this.check('zIncrBy', key);
    const z = this.zset(key, true)!;
    const n = (z.get(member) ?? 0) + by;
    z.set(member, n);
    this.bump(key);
    return n;
  }
  async zRange(
    key: string,
    start: number,
    stop: number,
    opts?: { reverse?: boolean; by?: 'rank' | 'score' },
  ): Promise<ZMember[]> {
    this.check('zRange', key);
    const z = this.zset(key, false);
    if (!z) return [];
    let all = [...z.entries()]
      .map(([member, score]) => ({ member, score }))
      .sort((a, b) => a.score - b.score || (a.member < b.member ? -1 : a.member > b.member ? 1 : 0));
    if (opts?.by === 'score') {
      all = all.filter((m) => m.score >= start && m.score <= stop);
      return opts.reverse ? all.reverse() : all;
    }
    if (opts?.reverse) all.reverse();
    const n = all.length;
    const s = start < 0 ? Math.max(0, n + start) : start;
    const e = stop < 0 ? n + stop : Math.min(stop, n - 1);
    return e < s ? [] : all.slice(s, e + 1);
  }
  async zRem(key: string, members: string[]): Promise<void> {
    this.check('zRem', key);
    const z = this.zset(key, false);
    if (!z) return;
    for (const m of members) z.delete(m);
    this.bump(key);
  }
  async zCard(key: string): Promise<number> {
    this.check('zCard', key);
    return this.zset(key, false)?.size ?? 0;
  }

  async watch(...keys: string[]): Promise<TxPort> {
    const watched = new Map(keys.map((k) => [k, this.versions.get(k) ?? 0]));
    const queue: Array<() => Promise<unknown>> = [];
    let inMulti = false;
    const q =
      (fn: () => Promise<unknown>) =>
      async (): Promise<void> => {
        if (!inMulti) {
          await fn();
          return;
        }
        queue.push(fn);
      };
    return {
      multi: async () => {
        inMulti = true;
      },
      exec: async () => {
        if (this.beforeExec) await this.beforeExec();
        for (const [k, ver] of watched) if ((this.versions.get(k) ?? 0) !== ver) return null;
        const out: unknown[] = [];
        // Commands run back-to-back with no awaits interleaving other callers' work.
        for (const fn of queue) out.push(await fn());
        return out;
      },
      discard: async () => {
        queue.length = 0;
        inMulti = false;
      },
      unwatch: async () => {
        watched.clear();
      },
      set: (k, v) => q(() => this.set(k, v))(),
      del: (...k) => q(() => this.del(...k))(),
      hSet: (k, f) => q(() => this.hSet(k, f))(),
      hDel: (k, f) => q(() => this.hDel(k, f))(),
      hIncrBy: (k, f, by) => q(() => this.hIncrBy(k, f, by))(),
      zAdd: (k, ...m) => q(() => this.zAdd(k, ...m))(),
      zIncrBy: (k, m, by) => q(() => this.zIncrBy(k, m, by))(),
    };
  }
}
