import { Hono, type Context } from 'hono';
import type { ApiError, PersonalRequest, PourRequest } from '../../shared/protocol';
import type { AppEnv } from '../app';
import { recordPour } from '../core/board';
import { dayIdForPost } from '../core/day';
import { recordPersonal } from '../core/personal';
import { buildView } from '../core/state';

const bad = (c: Context, e: ApiError, status: 400 | 401 | 404 | 409 | 429 = 400) => c.json(e, status);

export function apiRoutes(env: AppEnv): Hono {
  const api = new Hono();
  const { deps } = env;

  api.get('/state', async (c) => {
    const ctx = await env.ctx(c.req.raw);
    const view = await buildView(deps, ctx, c.req.query('postId') ?? ctx.postId);
    if (!view) return bad(c, { error: 'NO_DAY', message: 'No machine is running here yet. A moderator can start one from the subreddit menu.' }, 404);
    return c.json(view);
  });

  /** A finished pour: the build and what the phone counted. */
  api.post('/pour', async (c) => {
    const ctx = await env.ctx(c.req.raw);
    if (!ctx.userId || !ctx.username) return bad(c, { error: 'NOT_LOGGED_IN', message: 'Log in to Reddit to get on the leaderboard.' }, 401);
    let b: Partial<PourRequest> = {};
    try {
      b = (await c.req.json()) as Partial<PourRequest>;
    } catch {
      /* empty body */
    }
    const dayId = await dayIdForPost(deps.store, b.postId ?? ctx.postId);
    if (!dayId) return bad(c, { error: 'NO_DAY', message: 'No machine is running here yet.' }, 404);
    const out = await recordPour(deps, dayId, { userId: ctx.userId, username: ctx.username }, b.build, b.claimed);
    if ('error' in out) return bad(c, out, out.error === 'TOO_FAST' ? 429 : out.error === 'NO_DAY' ? 404 : out.error === 'LOCKED' ? 409 : 400);
    return c.json(out);
  });

  /** A finished Personal pour: keeps your best on that level. */
  api.post('/personal', async (c) => {
    const ctx = await env.ctx(c.req.raw);
    if (!ctx.userId) return bad(c, { error: 'NOT_LOGGED_IN', message: 'Log in to Reddit to save your stars.' }, 401);
    let b: Partial<PersonalRequest> = {};
    try {
      b = (await c.req.json()) as Partial<PersonalRequest>;
    } catch {
      /* empty body */
    }
    const out = await recordPersonal(deps, ctx.userId, b.level, b.claimed);
    if ('error' in out) return bad(c, out);
    return c.json(out);
  });

  return api;
}
