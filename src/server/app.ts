import { Hono } from 'hono';
import type { Deps, RequestCtx } from './core/deps';
import { apiRoutes } from './routes/api';
import { internalRoutes } from './routes/internal';

export type AppEnv = {
  deps: Deps;
  /** Resolves the identity of the current request (Devvit context or harness cookie). */
  ctx(req: Request): Promise<RequestCtx>;
};

export function createApp(env: AppEnv): Hono {
  const app = new Hono();
  app.route('/api', apiRoutes(env));
  app.route('/internal', internalRoutes(env));
  return app;
}
