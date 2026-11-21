import { describe, expect, it } from 'vitest';
import { K } from '../src/server/core/keys';
import { readMeta } from '../src/server/core/day';
import { FIXTURES } from '../src/shared/fixtures';
import { client, installWith, makeDeps } from './server-helpers';

describe('secrets never leak while OPEN', () => {
  it('no API response contains the solution or the Day secret', async () => {
    const env = makeDeps();
    const dayId = await installWith(env);
    const api = client(env);
    const secret = (await env.store.get(K.secret(dayId)))!;
    const responses = [
      await api.get('/api/state'),
      await api.post('/api/place', { socketId: 'D3', type: 'BUMPER', dir: 'L' }),
      await api.post('/api/predict', { balls: 1 }),
      await api.post('/api/remove', {}),
      await api.post('/api/place', { socketId: 'B2', type: 'RAMP', dir: 'DL' }),
      await api.as('').get('/api/state'),
    ];
    for (const r of responses) {
      expect(r.text).not.toContain(secret);
      expect(r.text).not.toContain('"solution"');
      expect(r.text).not.toContain('revealedSecret');
    }
    // The solution sockets are not singled out anywhere either.
    const sol = FIXTURES[0]!.solution!;
    expect(responses[0]!.json.level.solution).toBeUndefined();
    expect(sol.length).toBeGreaterThan(0);
  });

  it('after resolve the secret is revealed with the result', async () => {
    const env = makeDeps();
    const dayId = await installWith(env);
    const api = client(env);
    const meta = (await readMeta(env.store, dayId))!;
    env.clock.t = meta.locksAt + 1;
    await api.post('/internal/cron/tick');
    const r = await api.get(`/api/state?postId=${meta.postId}`);
    const secret = (await env.store.get(K.secret(dayId)))!;
    expect(r.json.result.revealedSecret).toBe(secret);
    expect(r.text).not.toContain('"solution"');
  });
});
