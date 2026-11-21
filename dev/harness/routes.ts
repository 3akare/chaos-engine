import { Hono } from 'hono';
import type { Deps, RequestCtx } from '../../src/server/core/deps';
import type { MemoryStore } from './memory-store';
import type { FakeReddit } from './fake-reddit';

export type HarnessEnv = {
  deps: Deps;
  store: MemoryStore;
  reddit: FakeReddit;
  clock: { offset: number; now(): number };
  ctx(req: Request): Promise<RequestCtx>;
};

export function harnessRoutes(env: HarnessEnv): Hono {
  const h = new Hono();
  h.get('/status', (c) => c.json({ now: env.clock.now(), keys: env.store.keys().length, posts: env.reddit.posts }));
  return h;
}
