/**
 * Local harness: mounts the real route handlers against an in-memory store and
 * a fake Reddit, serves the harness client build, and fakes the Devvit context.
 */
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { createApp } from '../../src/server/app';
import type { Deps, RequestCtx } from '../../src/server/core/deps';
import { MemoryStore } from './memory-store';
import { FakeReddit } from './fake-reddit';
import { harnessRoutes } from './routes';

const root = path.resolve(import.meta.dirname, '../..');
const out = path.join(root, 'dist/harness');
const port = Number(process.env.PORT ?? 5174);

/** Harness clock: real time plus an offset that "Advance day" can bump. */
export const clock = { offset: 0, now: () => Date.now() + clock.offset };
const store = new MemoryStore(clock.now);
const reddit = new FakeReddit(clock.now);

const deps: Deps = {
  store,
  reddit,
  now: clock.now,
  randomBytes: (n) => new Uint8Array(randomBytes(n)),
  log: (level, msg, extra) => console[level](`[${level}] ${msg}`, extra ?? ''),
};

const cookie = (req: Request, name: string): string | undefined =>
  req.headers
    .get('cookie')
    ?.split(/;\s*/)
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1);

const ctx = async (req: Request): Promise<RequestCtx> => {
  const user = cookie(req, 'ce_user') ?? 'alice';
  return {
    userId: `t2_${user}`,
    username: user,
    postId: new URL(req.url).searchParams.get('postId') ?? undefined,
    isMod: true,
  };
};

const app = new Hono();
app.route('/', createApp({ deps, ctx }));
app.route('/__harness', harnessRoutes({ deps, store, reddit, clock, ctx }));

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
  '.json': 'application/json',
};
const pages: Record<string, string> = {
  '/': 'dev/harness/shell/index.html',
  '/gallery': 'dev/harness/shell/gallery.html',
  '/splash.html': 'src/client/splash.html',
  '/game.html': 'src/client/game.html',
};
app.get('*', async (c) => {
  const p = c.req.path;
  const rel = pages[p] ?? p.replace(/^\/+/, '');
  const file = path.join(out, rel);
  if (!file.startsWith(out)) return c.notFound();
  try {
    const body = await readFile(file);
    return c.body(body, 200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  } catch {
    return c.text(`Not built yet: ${rel}. Is "vite build --watch" running?`, 404);
  }
});

serve({ fetch: app.fetch, port }, () => console.log(`Chaos Engine harness on http://localhost:${port}`));
