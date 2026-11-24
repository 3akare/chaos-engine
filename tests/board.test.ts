import { describe, expect, it } from 'vitest';
import { K } from '../src/server/core/keys';
import { readMeta } from '../src/server/core/day';
import { rankScore } from '../src/server/core/board';
import { runNow, tick } from '../src/server/core/pipeline';
import { runPour } from '../src/shared/pour/sim';
import type { Piece } from '../src/shared/pour/types';
import type { DayResult } from '../src/shared/protocol';
import { client, installWith, makeDeps, TEST_MACHINE } from './server-helpers';

/** On the test machine the empty board catches some balls and this ramp throws them all away. */
const BUILD: Piece[] = [{ type: 'ramp', x: 220, y: 380, a: 20 }];
const GOOD: Piece[] = [];

async function setup() {
  const env = makeDeps();
  const dayId = await installWith(env);
  return { env, dayId, api: client(env) };
}

describe('leaderboard', () => {
  it('a pour that raises your best is re-run on the server; the server count stands', async () => {
    const { env, api } = await setup();
    const real = runPour(TEST_MACHINE, BUILD);
    const r = await api.as('alice').post('/api/pour', { build: BUILD, claimed: 100 });
    expect(r.status).toBe(200);
    expect(r.json.score).toBe(real);
    expect(r.json.best).toBe(real);
    expect(r.json.rank).toBe(1);
    expect(env.logs.some((l) => l.includes('mismatch'))).toBe(real !== 100);
  });

  it('ranks by balls, then by who got there first', async () => {
    const { env, api } = await setup();
    expect(runPour(TEST_MACHINE, GOOD)).toBeGreaterThan(runPour(TEST_MACHINE, BUILD));
    await api.as('alice').post('/api/pour', { build: BUILD, claimed: 0 });
    env.clock.t += 60_000;
    await api.as('bob').post('/api/pour', { build: GOOD, claimed: runPour(TEST_MACHINE, GOOD) });
    env.clock.t += 60_000;
    await api.as('carol').post('/api/pour', { build: GOOD, claimed: runPour(TEST_MACHINE, GOOD) });
    const s = await api.as('carol').get('/api/state');
    const names = s.json.board.map((e: { username: string }) => e.username);
    expect(names).toEqual(['bob', 'carol', 'alice']);
    expect(s.json.me.rank).toBe(2);
    expect(s.json.me.build).toEqual(GOOD);
    expect(s.json.totals.pours).toBe(3);
    expect(rankScore(50, 2000, 0)).toBeGreaterThan(rankScore(50, 5000, 0));
    expect(rankScore(51, 9e9, 0)).toBeGreaterThan(rankScore(50, 0, 0));
  });

  it('rejects junk builds, pours too close together, and logged-out players', async () => {
    const { env, api } = await setup();
    expect((await api.as('alice').post('/api/pour', { build: [{ type: 'spring', x: 1, y: 1, a: 0 }], claimed: 5 })).status).toBe(400);
    expect((await api.as('alice').post('/api/pour', { build: BUILD, claimed: 5 })).status).toBe(200);
    expect((await api.as('alice').post('/api/pour', { build: BUILD, claimed: 5 })).status).toBe(429);
    env.clock.t += 3000;
    expect((await api.as('alice').post('/api/pour', { build: BUILD, claimed: 5 })).status).toBe(200);
    expect((await api.as('').post('/api/pour', { build: BUILD, claimed: 5 })).status).toBe(401);
  });

  it('closes at lock, reveals the Build of the Day, comments, and opens the next machine', async () => {
    const { env, dayId, api } = await setup();
    const real = runPour(TEST_MACHINE, BUILD);
    await api.as('alice').post('/api/pour', { build: BUILD, claimed: real });
    // Before lock: nobody sees anyone's build but their own.
    const before = await api.as('bob').get('/api/state');
    expect(before.json.result).toBeNull();
    expect(JSON.stringify(before.json)).not.toContain('"x":220');
    await env.store.set('ce:level:2', JSON.stringify({ ...TEST_MACHINE, name: 'Second' }));
    const rep = await runNow(env.deps);
    expect(rep.stages).toEqual(['OPEN→LOCKED', 'LOCKED→RESOLVED', 'RESOLVED→COMMENTED', 'COMMENTED→HANDED_OFF']);
    const res = JSON.parse((await env.store.get(K.result(dayId)))!) as DayResult;
    expect(res.winner?.username).toBe('alice');
    expect(res.winner?.build).toEqual(BUILD);
    expect([...env.reddit.comments.values()].flat()[0]!.body).toContain('Build of the Day');
    expect((await api.as('alice').post('/api/pour', { postId: (await readMeta(env.store, dayId))!.postId, build: BUILD, claimed: 1 })).status).toBe(409);
    const day2 = (await readMeta(env.store, (await env.store.get(K.current))!))!;
    expect(day2.dayNumber).toBe(2);
    expect(day2.goal).toBeGreaterThanOrEqual(2000);
    const s = await api.as('bob').get('/api/state');
    expect(s.json.yesterday.winner).toBe('alice');
    // Running the tick again changes nothing.
    expect((await tick(env.deps)).stages).toEqual([]);
  });
});
