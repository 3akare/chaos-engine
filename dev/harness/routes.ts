/** Dev-only harness controls: switch user, advance day, seed demo, seed gallery + pinning. */
import { Hono } from 'hono';
import type { Deps, RequestCtx } from '../../src/server/core/deps';
import type { MemoryStore } from './memory-store';
import type { FakeReddit } from './fake-reddit';
import { currentDayId, readMachine, readMeta } from '../../src/server/core/day';
import { K } from '../../src/server/core/keys';
import { install, runNow, tick } from '../../src/server/core/pipeline';
import { seedDemo } from '../../src/server/core/seed';
import { readConfig } from '../../src/server/core/levels';
import { generateDay, historyOf, validatedAttempts, type DayHistory } from '../../src/shared/generator/generate';
import { levelOf, simulate, solutionPieces, VARIANTS } from '../../src/shared/sim';
import type { Machine } from '../../src/shared/types';

export type HarnessEnv = {
  deps: Deps;
  store: MemoryStore;
  reddit: FakeReddit;
  clock: { offset: number; now(): number };
  ctx(req: Request): Promise<RequestCtx>;
};

const DAY = 86_400_000;

export function harnessRoutes(env: HarnessEnv): Hono {
  const h = new Hono();
  const { deps, store } = env;

  h.get('/status', async (c) => {
    const id = await currentDayId(store);
    const meta = id ? await readMeta(store, id) : null;
    const days = [];
    for (let n = 1; n <= (meta?.dayNumber ?? 0); n++) {
      const did = await store.get(K.dayByNumber(n));
      const m = did ? await readMeta(store, did) : null;
      if (m) days.push({ dayNumber: n, status: m.status, postId: m.postId, title: m.title, locksAt: m.locksAt });
    }
    return c.json({ now: env.clock.now(), user: (await env.ctx(c.req.raw)).username, current: meta, days });
  });

  h.post('/user', async (c) => {
    const { name } = (await c.req.json()) as { name: string };
    c.header('set-cookie', `ce_user=${encodeURIComponent(name)}; Path=/; SameSite=Lax`);
    return c.json({ ok: true });
  });

  h.post('/install', async (c) => {
    await install(deps);
    return c.json(await tick(deps));
  });

  h.post('/reset', async (c) => {
    store.flush();
    env.reddit.posts = [];
    env.reddit.comments.clear();
    env.clock.offset = 0;
    await install(deps);
    return c.json(await tick(deps));
  });

  /** Jump the clock to the lock time and run the same cron handler. */
  h.post('/advance', async (c) => {
    const id = await currentDayId(store);
    const meta = id ? await readMeta(store, id) : null;
    if (meta && meta.status === 'OPEN') env.clock.offset += Math.max(0, meta.locksAt - env.clock.now() + 1000);
    return c.json(await tick(deps));
  });

  h.post('/run-now', async (c) => c.json(await runNow(deps)));
  h.post('/seed', async (c) => c.json({ message: await seedDemo(deps) }));

  /** Next `count` Days: stored machines where they exist, previews otherwise (chained histories, pins honoured). */
  h.get('/gallery', async (c) => {
    const count = Number(c.req.query('count') ?? 30);
    const id = await currentDayId(store);
    const meta = id ? await readMeta(store, id) : null;
    if (!meta) return c.json({ error: 'not installed' }, 400);
    const cfg = await readConfig(deps);
    const out: Array<{ dayNumber: number; stored: boolean; pinned: number | null; machine: Machine; solutionDelivers: number; ms: number }> = [];
    const hist: DayHistory[] = [];
    for (const n of [meta.dayNumber - 1, meta.dayNumber]) {
      const m = n >= 1 ? await readMachine(store, n) : null;
      if (m) hist.unshift(historyOf(m));
    }
    for (let n = meta.dayNumber; n < meta.dayNumber + count; n++) {
      const pin = await store.get(K.pin(n));
      let m = await readMachine(store, n);
      const stored = m !== null;
      const t0 = performance.now();
      if (!m) {
        m = generateDay({ installSalt: cfg.installSalt, dayNumber: n, openMs: meta.locksAt + (n - meta.dayNumber - 1) * DAY, history: hist.slice(0, 2), pinAttempt: pin !== undefined ? Number(pin) : undefined }).machine;
      }
      const ms = performance.now() - t0;
      if (n > meta.dayNumber) hist.unshift(historyOf(m));
      const level = levelOf(m);
      const sol = solutionPieces(m);
      const solutionDelivers = VARIANTS.filter((v) => simulate(level, sol, { variant: v.id }).end === 'success').length;
      out.push({ dayNumber: n, stored, pinned: pin !== undefined ? Number(pin) : null, machine: m, solutionDelivers, ms: Math.round(ms) });
    }
    return c.json({ current: meta.dayNumber, days: out });
  });

  /** Other validated attempts for a Day, for curation (§5.7). */
  h.get('/alternatives', async (c) => {
    const n = Number(c.req.query('day'));
    const id = await currentDayId(store);
    const meta = id ? await readMeta(store, id) : null;
    if (!meta) return c.json({ error: 'not installed' }, 400);
    const cfg = await readConfig(deps);
    const hist: DayHistory[] = [];
    for (const k of [n - 1, n - 2]) {
      const m = k >= 1 ? await readMachine(store, k) : null;
      if (m) hist.push(historyOf(m));
    }
    const alts = validatedAttempts({ installSalt: cfg.installSalt, dayNumber: n, openMs: meta.locksAt + (n - meta.dayNumber - 1) * DAY, history: hist }, 4);
    return c.json({ day: n, alternatives: alts });
  });

  /** Pin an attempt for a future Day; its stored machine is cleared so the next tick regenerates it. */
  h.post('/pin', async (c) => {
    const { day, attempt } = (await c.req.json()) as { day: number; attempt: number | null };
    const id = await currentDayId(store);
    const meta = id ? await readMeta(store, id) : null;
    if (!meta || day <= meta.dayNumber) return c.json({ error: 'only future Days can be pinned' }, 400);
    if (attempt === null) await store.del(K.pin(day));
    else await store.set(K.pin(day), String(attempt));
    await store.del(K.level(day));
    await tick(deps);
    return c.json({ ok: true });
  });

  h.get('/machine', async (c) => {
    const n = Number(c.req.query('day'));
    const m = await readMachine(store, n);
    return m ? c.json(m) : c.json({ error: 'not stored' }, 404);
  });

  return h;
}
