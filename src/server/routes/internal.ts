import { Hono } from 'hono';
import type { AppEnv } from '../app';

export function internalRoutes(_env: AppEnv): Hono {
  const internal = new Hono();
  return internal;
}
