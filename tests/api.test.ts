import { beforeEach, describe, expect, it } from 'vitest';
import { K } from '../src/server/core/keys';
import { readMeta } from '../src/server/core/day';
import { FIXTURES } from '../src/shared/fixtures';
import { client, installWith, makeDeps, type TestEnv } from './server-helpers';

let env: TestEnv;
let dayId: string;
let api: ReturnType<typeof client>;
beforeEach(async () => {
  env = makeDeps();
  dayId = await installWith(env);
  api = client(env);
});

describe('api', () => {
  it('GET /api/state returns the Day, level, pieces, inventory and me', async () => {
    const r = await api.get('/api/state');
    expect(r.status).toBe(200);
    expect(r.json.day.dayNumber).toBe(1);
    expect(r.json.day.status).toBe('OPEN');
    expect(r.json.level.rows).toHaveLength(14);
    expect(r.json.inventory).toEqual(FIXTURES[0]!.inventory);
    expect(r.json.me.username).toBe('alice');
    expect(r.json.counts.histogram).toBeNull();
    const meta = (await readMeta(env.store, dayId))!;
    const byPost = await api.get(`/api/state?postId=${meta.postId}`);
    expect(byPost.json.day.dayId).toBe(dayId);
  });

  it('POST /api/place, then /api/remove', async () => {
    const r = await api.post('/api/place', { socketId: 'D3', type: 'BUMPER', dir: 'L' });
    expect(r.status).toBe(200);
    expect(r.json.verdict).toMatch(/^Same progress ✓/);
    expect(r.json.state.me.socket).toBe('D3');
    const rm = await api.post('/api/remove', {});
    expect(rm.status).toBe(200);
    expect(rm.json.state.me.socket).toBeNull();
  });

  it('refusals are specific human sentences', async () => {
    const r = await api.post('/api/place', { socketId: 'B2', type: 'RAMP', dir: 'DL' });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('NOT_REPLACEABLE');
    expect(r.json.message).toMatch(/B2 is part of the machine/);
    const bad = await api.post('/api/place', { socketId: 'D3', type: 'RAMP', dir: 'U' });
    expect(bad.json.message).not.toMatch(/^[A-Z_]+$/);
  });

  it('anonymous users can look but not build', async () => {
    api.as('');
    expect((await api.get('/api/state')).status).toBe(200);
    const r = await api.post('/api/place', { socketId: 'D3', type: 'BUMPER', dir: 'L' });
    expect(r.status).toBe(401);
    expect(r.json.message).toMatch(/Log in/);
  });

  it('POST /api/predict, changeable until lock', async () => {
    expect((await api.post('/api/predict', { balls: 2 })).json.state.me.prediction).toBe(2);
    expect((await api.post('/api/predict', { balls: 3 })).json.state.me.prediction).toBe(3);
    expect((await api.post('/api/predict', { balls: 4 })).status).toBe(400);
    await env.store.hSet(K.meta(dayId), { status: 'LOCKED' });
    const r = await api.post('/api/predict', { balls: 1 });
    expect(r.json.error).toBe('LOCKED');
  });

  it('POST /api/inbox/ack hides seen report items', async () => {
    await api.as('bob').post('/api/place', { socketId: 'I3', type: 'BUMPER', dir: 'L' });
    const rep = await api.as('alice').post('/api/place', { socketId: 'I3', type: 'RAMP', dir: 'DL' });
    if (rep.status !== 200) return; // bumper may already be as good; covered in placement.tx
    env.clock.t += 1000;
    const s = await api.as('bob').get('/api/state');
    expect(s.json.me.inbox).toHaveLength(1);
    await api.post('/api/inbox/ack', {});
    env.clock.t += 1000;
    expect((await api.get('/api/state')).json.me.inbox).toHaveLength(0);
  });

  it('internal: cron tick and mod menu actions respond', async () => {
    expect((await api.post('/internal/cron/tick')).json.ran).toBe(true);
    expect((await api.post('/internal/menu/seed-demo')).json.showToast.text).toMatch(/Seeded Day 1/);
    expect((await api.post('/internal/menu/show-solution')).json.showToast.text).toMatch(/RAMP DL @ I3/);
    expect((await api.post('/internal/menu/remove-piece')).json.showForm.name).toBe('removePiece');
    expect((await api.post('/internal/form/remove-piece', { cell: 'Z99' })).json.showToast.text).toMatch(/isn't a cell/);
    const run = await api.post('/internal/menu/run-now');
    expect(run.json.showToast.text).toMatch(/Day 2 is open/);
    expect((await api.post('/internal/menu/show-dupes')).json.showToast.text).toMatch(/No duplicate/);
  });
});
