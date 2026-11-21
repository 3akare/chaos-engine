import { serve } from '@hono/node-server';
import { createServer, getServerPort } from '@devvit/web/server';
import { createApp } from './app';
import { devvitDeps, devvitCtx } from './devvit';

const app = createApp({ deps: devvitDeps, ctx: devvitCtx });

serve({ fetch: app.fetch, createServer, port: getServerPort() });
