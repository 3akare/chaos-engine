import { Hono, type Context } from 'hono';
import type { ApiError, DayView, PlaceRequest, PredictRequest } from '../../shared/protocol';
import { PIECE_DIRS, PIECE_TYPES, type PieceType } from '../../shared/types';
import type { AppEnv } from '../app';
import { dayIdForPost } from '../core/day';
import { applyAction } from '../core/placement';
import { predict } from '../core/predict';
import { ackInbox, buildView } from '../core/state';

const bad = (c: Context, e: ApiError, status: 400 | 401 | 404 | 409 = 400) => c.json(e, status);

export function apiRoutes(env: AppEnv): Hono {
  const api = new Hono();
  const { deps } = env;

  const body = async <T>(c: Context): Promise<Partial<T>> => {
    try {
      return (await c.req.json()) as Partial<T>;
    } catch {
      return {};
    }
  };

  const stateFor = async (c: Context, postId: string | undefined): Promise<DayView | null> => buildView(deps, await env.ctx(c.req.raw), postId);

  api.get('/state', async (c) => {
    const ctx = await env.ctx(c.req.raw);
    const view = await buildView(deps, ctx, c.req.query('postId') ?? ctx.postId);
    if (!view) return bad(c, { error: 'NO_DAY', message: "No machine is running here yet. A moderator can start one from the subreddit menu." }, 404);
    return c.json(view);
  });

  api.post('/place', async (c) => {
    const ctx = await env.ctx(c.req.raw);
    if (!ctx.userId || !ctx.username) return bad(c, { error: 'NOT_LOGGED_IN', message: 'Log in to Reddit to add a piece.' }, 401);
    const b = await body<PlaceRequest>(c);
    const type = b.type as PieceType;
    if (!b.socketId || !PIECE_TYPES.includes(type) || !b.dir || !PIECE_DIRS[type].includes(b.dir)) return bad(c, { error: 'BAD_REQUEST', message: "That piece isn't valid." });
    const postId = b.postId ?? ctx.postId;
    const dayId = await dayIdForPost(deps.store, postId);
    if (!dayId) return bad(c, { error: 'NO_DAY', message: 'No machine is running here yet.' }, 404);
    const out = await applyAction(deps, dayId, { userId: ctx.userId, username: ctx.username }, { kind: 'set', socket: b.socketId, type, dir: b.dir });
    if ('error' in out && out.error) return bad(c, out, out.error === 'BUSY' ? 409 : 400);
    return c.json({ ok: true, verdict: 'verdict' in out ? out.verdict : '', state: await stateFor(c, postId) });
  });

  api.post('/remove', async (c) => {
    const ctx = await env.ctx(c.req.raw);
    if (!ctx.userId || !ctx.username) return bad(c, { error: 'NOT_LOGGED_IN', message: 'Log in to Reddit to change pieces.' }, 401);
    const b = await body<{ postId: string }>(c);
    const postId = b.postId ?? ctx.postId;
    const dayId = await dayIdForPost(deps.store, postId);
    if (!dayId) return bad(c, { error: 'NO_DAY', message: 'No machine is running here yet.' }, 404);
    const out = await applyAction(deps, dayId, { userId: ctx.userId, username: ctx.username }, { kind: 'remove' });
    if ('error' in out && out.error) return bad(c, out, out.error === 'BUSY' ? 409 : 400);
    return c.json({ ok: true, verdict: 'verdict' in out ? out.verdict : '', state: await stateFor(c, postId) });
  });

  api.post('/predict', async (c) => {
    const ctx = await env.ctx(c.req.raw);
    if (!ctx.userId) return bad(c, { error: 'NOT_LOGGED_IN', message: 'Log in to Reddit to predict.' }, 401);
    const b = await body<PredictRequest>(c);
    const postId = b.postId ?? ctx.postId;
    const dayId = await dayIdForPost(deps.store, postId);
    if (!dayId) return bad(c, { error: 'NO_DAY', message: 'No machine is running here yet.' }, 404);
    const out = await predict(deps, dayId, ctx.userId, Number(b.balls));
    if ('error' in out) return bad(c, out);
    return c.json({ ok: true, state: await stateFor(c, postId) });
  });

  api.post('/inbox/ack', async (c) => {
    const ctx = await env.ctx(c.req.raw);
    if (ctx.userId) await ackInbox(deps, ctx.userId);
    return c.json({ ok: true });
  });

  return api;
}
