import { Hono } from 'hono';
import type { AppEnv } from '../app';

export function apiRoutes(env: AppEnv): Hono {
  const api = new Hono();
  api.get('/health', async (c) => {
    const ctx = await env.ctx(c.req.raw);
    return c.json({ ok: true, user: ctx.username ?? null, now: env.deps.now() });
  });
  return api;
}
