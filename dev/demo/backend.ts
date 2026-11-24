/**
 * The real server (same routes and pipeline as on Reddit) running inside the page,
 * over an in-memory store that is saved to the browser. `fetch('/api/…')` is routed to it.
 */
import { createApp } from '../../src/server/app';
import type { Deps } from '../../src/server/core/deps';
import { K } from '../../src/server/core/keys';
import { readMeta } from '../../src/server/core/day';
import { MemoryStore } from '../harness/memory-store';
import { FakeReddit } from '../harness/fake-reddit';
import { clearState, loadState, saveState } from './persist';

export const state = loadState();
const clock = { now: () => Date.now() + state.offset };
export const store = new MemoryStore(clock.now);
export const reddit = new FakeReddit(clock.now, 'chaos-engine-game');
try {
  if (state.store) store.restore(state.store);
  if (state.reddit) reddit.restore(state.reddit);
} catch {
  /* corrupt save: start fresh */
}

const deps: Deps = {
  store,
  reddit,
  now: clock.now,
  randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
  log: (level, msg) => console[level === 'error' ? 'error' : 'log'](`[server] ${msg}`),
};

export const app = createApp({
  deps,
  ctx: async (req) => {
    const u = state.user;
    return { userId: `t2_${u}`, username: u, postId: new URL(req.url).searchParams.get('postId') ?? state.view.postId, isMod: true };
  },
});

export function persist(): void {
  state.store = store.snapshot();
  state.reddit = reddit.snapshot();
  saveState(state);
}

const ORIGIN = 'https://demo.chaos-engine.local';
export async function call(method: string, path: string, body?: unknown): Promise<Response> {
  const res = await app.fetch(new Request(ORIGIN + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : null }));
  persist();
  return res;
}

const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  if (url.startsWith('/api/') || url.startsWith('/internal/')) {
    const res = await app.fetch(new Request(ORIGIN + url, init));
    if ((init?.method ?? 'GET') !== 'GET') persist();
    return res;
  }
  return realFetch(input, init);
};

/** Install (Day 1) on first run, and let the scheduler catch up with real time. */
export async function boot(): Promise<void> {
  if (!(await store.get(K.current))) await call('POST', '/internal/triggers/on-app-install');
  else await call('POST', '/internal/cron/tick');
}

/** Jump the clock to today's lock time and run the scheduler, exactly as the 02:00 UTC job would. */
export async function nextDay(): Promise<string> {
  const id = await store.get(K.current);
  const meta = id ? await readMeta(store, id) : null;
  if (meta && meta.status === 'OPEN') state.offset += Math.max(0, meta.locksAt - clock.now() + 1000);
  const r = (await (await call('POST', '/internal/cron/tick')).json()) as { stages: string[] };
  return r.stages.join(' → ');
}

export async function seedDemo(): Promise<string> {
  const r = (await (await call('POST', '/internal/menu/seed-demo')).json()) as { showToast?: { text: string } };
  return r.showToast?.text ?? '';
}

export function resetAll(): void {
  clearState();
}

export const now = (): number => clock.now();
