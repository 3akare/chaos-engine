import { createApp } from '../src/server/app';
import type { Deps, RequestCtx } from '../src/server/core/deps';
import { MemoryStore } from '../dev/harness/memory-store';
import { FakeReddit } from '../dev/harness/fake-reddit';
import { install } from '../src/server/core/pipeline';
import { K } from '../src/server/core/keys';
import type { Machine } from '../src/shared/pour/types';

/** A small machine: chute straight over the bucket, one ledge in the way. */
export const TEST_MACHINE: Machine = {
  name: 'Test Drop',
  seed: 7,
  spawn: { x: 180, y: 18, vx: 0 },
  bucket: { x: 180, y: 566, w: 70 },
  blocks: [{ x: 120, y: 300, w: 140, h: 18, a: 12 }],
  pegs: [],
  spinners: [],
  tools: { ramp: 2, bumper: 1 },
};

export function makeDeps(start = Date.UTC(2026, 11, 7, 13)) {
  const clock = { t: start };
  const store = new MemoryStore(() => clock.t);
  const reddit = new FakeReddit(() => clock.t);
  let seq = 0;
  const logs: string[] = [];
  const deps: Deps = {
    store,
    reddit,
    now: () => clock.t,
    randomBytes: (n) => {
      const b = new Uint8Array(n);
      for (let i = 0; i < n; i++) b[i] = (seq * 31 + i * 7 + 13) & 0xff;
      seq++;
      return b;
    },
    log: (level, msg) => logs.push(`${level}: ${msg}`),
  };
  return { deps, store, reddit, clock, logs };
}

export type TestEnv = ReturnType<typeof makeDeps>;

/** Install with a known machine as Day 1 (pre-stored, so no generation is needed). */
export async function installWith(env: TestEnv, m: Machine = TEST_MACHINE): Promise<string> {
  await env.store.set(K.level(1), JSON.stringify(m));
  const id = await install(env.deps);
  return id!;
}

export function client(env: TestEnv) {
  let user = 'alice';
  const app = createApp({
    deps: env.deps,
    ctx: async (req: Request): Promise<RequestCtx> => ({ userId: user ? `t2_${user}` : undefined, username: user || undefined, postId: new URL(req.url).searchParams.get('postId') ?? undefined, isMod: true }),
  });
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: res.status, text, json: JSON.parse(text) as any };
  };
  return {
    as(u: string) {
      user = u;
      return this;
    },
    get: (p: string) => call('GET', p),
    post: (p: string, b?: unknown) => call('POST', p, b),
  };
}
