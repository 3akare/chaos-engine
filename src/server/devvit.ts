/** Wires the server ports to the real Devvit runtime. Only imported by index.ts. */
import { randomBytes } from 'node:crypto';
import { context, reddit, redis } from '@devvit/web/server';
import type { Deps, RedditPort, RequestCtx, StorePort, TxPort } from './core/deps';

const tx = (t: Awaited<ReturnType<typeof redis.watch>>): TxPort => {
  let queued = 0;
  return {
    multi: async () => {
      await t.multi();
    },
    exec: async () => {
      try {
        const out = await t.exec();
        // An aborted EXEC (watched key changed) yields nil / no per-command results.
        if (out == null) return null;
        if (queued > 0 && out.length < queued) return null;
        return out;
      } catch {
        return null;
      }
    },
    discard: async () => {
      await t.discard();
    },
    unwatch: async () => {
      await t.unwatch();
    },
    set: async (k, v) => {
      queued++;
      await t.set(k, v);
    },
    del: async (...k) => {
      queued++;
      await t.del(...k);
    },
    hSet: async (k, f) => {
      queued++;
      await t.hSet(k, f);
    },
    hDel: async (k, f) => {
      queued++;
      await t.hDel(k, f);
    },
    hIncrBy: async (k, f, by) => {
      queued++;
      await t.hIncrBy(k, f, by);
    },
    zAdd: async (k, ...m) => {
      queued++;
      await t.zAdd(k, ...m);
    },
    zIncrBy: async (k, m, by) => {
      queued++;
      await t.zIncrBy(k, m, by);
    },
  };
};

const store: StorePort = {
  get: (k) => redis.get(k),
  set: async (k, v, o) => {
    await redis.set(k, v, o);
  },
  del: (...k) => redis.del(...k),
  hGet: (k, f) => redis.hGet(k, f),
  hGetAll: async (k) => (await redis.hGetAll(k)) ?? {},
  hSet: async (k, f) => {
    await redis.hSet(k, f);
  },
  hSetNX: async (k, f, v) => (await redis.hSetNX(k, f, v)) === 1,
  hDel: async (k, f) => {
    if (f.length) await redis.hDel(k, f);
  },
  hIncrBy: (k, f, by) => redis.hIncrBy(k, f, by),
  zAdd: async (k, ...m) => {
    await redis.zAdd(k, ...m);
  },
  zIncrBy: (k, m, by) => redis.zIncrBy(k, m, by),
  zRange: (k, a, b, o) => redis.zRange(k, a, b, { by: o?.by ?? 'rank', reverse: o?.reverse ?? false }),
  zRem: async (k, m) => {
    if (m.length) await redis.zRem(k, m);
  },
  zCard: (k) => redis.zCard(k),
  zRank: async (k, m) => (await redis.zRank(k, m)) ?? undefined,
  zScore: async (k, m) => (await redis.zScore(k, m)) ?? undefined,
  watch: async (...k) => tx(await redis.watch(...k)),
};

const redditPort: RedditPort = {
  appUsername: async () => (await reddit.getAppUser())?.username ?? context.appSlug,
  submitDayPost: async ({ title, textFallback }) => {
    const p = await reddit.submitCustomPost({ title, entry: 'default', textFallback: { text: textFallback } });
    return { id: p.id, title: p.title, authorName: p.authorName, createdAt: p.createdAt.getTime(), url: p.url };
  },
  submitResultsComment: async (postId, body) => {
    const c = await reddit.submitComment({ id: postId as `t3_${string}`, text: body, runAs: 'APP' });
    try {
      await c.distinguish(true);
    } catch {
      // Sticky needs mod permissions for the app account; the comment still stands.
    }
    return { id: c.id, body: c.body, authorName: c.authorName, createdAt: c.createdAt.getTime() };
  },
  newPosts: async (limit) => {
    const posts = await reddit.getNewPosts({ subredditName: context.subredditName, limit, pageSize: limit }).all();
    return posts.map((p) => ({ id: p.id, title: p.title, authorName: p.authorName, createdAt: p.createdAt.getTime() }));
  },
  postComments: async (postId, limit) => {
    const cs = await reddit.getComments({ postId: postId as `t3_${string}`, limit, pageSize: limit, depth: 1 }).all();
    return cs.map((c) => ({ id: c.id, body: c.body, authorName: c.authorName, createdAt: c.createdAt.getTime() }));
  },
  postUrl: (postId) => `https://www.reddit.com/r/${context.subredditName}/comments/${postId.replace(/^t3_/, '')}`,
};

export const devvitDeps: Deps = {
  store,
  reddit: redditPort,
  now: () => Date.now(),
  randomBytes: (n) => new Uint8Array(randomBytes(n)),
  log: (level, msg, extra) => console[level](`[chaos-engine] ${msg}`, extra ?? ''),
};

export const devvitCtx = async (req: Request): Promise<RequestCtx> => {
  const url = new URL(req.url);
  return {
    userId: context.userId,
    username: context.username,
    postId: context.postId ?? url.searchParams.get('postId') ?? undefined,
    // Mod-only endpoints are gated by devvit.json `forUserType: moderator`.
    isMod: url.pathname.startsWith('/internal/menu/'),
  };
};
