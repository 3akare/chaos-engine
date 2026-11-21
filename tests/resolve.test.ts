import { beforeEach, describe, expect, it } from 'vitest';
import { applyAction } from '../src/server/core/placement';
import { lockDay, tick } from '../src/server/core/pipeline';
import { resolveDay } from '../src/server/core/resolve';
import { K } from '../src/server/core/keys';
import { readMeta, readSubStats, readUserStats } from '../src/server/core/day';
import { predict } from '../src/server/core/predict';
import { sha256Hex } from '../src/shared/sha256';
import type { DayResult } from '../src/shared/protocol';
import { installWith, makeDeps, type TestEnv } from './server-helpers';

let env: TestEnv;
let dayId: string;
beforeEach(async () => {
  env = makeDeps();
  dayId = await installWith(env);
});

const build = async () => {
  env.clock.t += 60_000;
  const a = await applyAction(env.deps, dayId, { userId: 'a', username: 'alice' }, { kind: 'set', socket: 'I3', type: 'RAMP', dir: 'DL' });
  env.clock.t += 60_000;
  const b = await applyAction(env.deps, dayId, { userId: 'b', username: 'bob' }, { kind: 'set', socket: 'B13', type: 'SPRING', dir: 'UR' });
  env.clock.t += 60_000;
  const c = await applyAction(env.deps, dayId, { userId: 'c', username: 'carol' }, { kind: 'set', socket: 'G6', type: 'BUMPER', dir: 'L' });
  expect([a, b, c].map((x) => ('error' in x && x.error ? x.message : 'ok'))).toEqual(['ok', 'ok', 'ok']);
};

const lockAndResolve = async () => {
  const meta = (await readMeta(env.store, dayId))!;
  env.clock.t = meta.locksAt + 1000;
  expect(await lockDay(env.deps, dayId)).toBe(true);
  expect(await resolveDay(env.deps, dayId)).toBe(true);
  return JSON.parse((await env.store.get(K.result(dayId)))!) as DayResult;
};

describe('resolve', () => {
  it('scores the frozen board and awards the pieces that mattered', async () => {
    await build();
    const r = await lockAndResolve();
    expect(r.perBall[0].end).toBe('success');
    expect(r.score).toBeGreaterThanOrEqual(1);
    expect(['alice', 'bob']).toContain(r.awards.mvp?.username);
    expect(r.awards.clutch?.username).toBe('bob'); // the last placement that raised P
    expect(r.awards.mostTouched).not.toBeNull();
    expect(r.awards.mvp?.username).not.toBe('carol'); // carol's bumper is dormant
  });

  it('is idempotent: running it twice changes nothing', async () => {
    await build();
    await lockAndResolve();
    const snap = JSON.stringify(env.store.keys().sort().map((k) => k));
    const sub1 = await readSubStats(env.store);
    const res1 = await env.store.get(K.result(dayId));
    expect(await resolveDay(env.deps, dayId)).toBe(true);
    expect(await readSubStats(env.store)).toEqual(sub1);
    expect(await env.store.get(K.result(dayId))).toBe(res1);
    expect(JSON.stringify(env.store.keys().sort().map((k) => k))).toBe(snap);
  });

  it('updates stats, streaks and predictions', async () => {
    await build();
    await predict(env.deps, dayId, 'a', 1);
    await predict(env.deps, dayId, 'd', 3);
    const r = await lockAndResolve();
    const sub = await readSubStats(env.store);
    expect(sub.totalDays).toBe(1);
    expect(sub.streak).toBe(r.score >= 1 ? 1 : 0);
    expect(sub.perfectDays).toBe(r.score === 3 ? 1 : 0);
    const a = await readUserStats(env.store, 'a');
    expect(a.predStreak).toBe(r.score === 1 ? 1 : 0);
    expect(a.touchedInFinal).toBeGreaterThanOrEqual(1);
    expect(r.predictions[1] + r.predictions[3]).toBe(2);
    const inboxA = await env.store.zRange(K.inbox('a'), 0, -1);
    expect(inboxA.length).toBeGreaterThan(0);
  });

  it('reveals the secret only after resolve, and it matches the published hash', async () => {
    const meta = (await readMeta(env.store, dayId))!;
    const r = await lockAndResolve();
    expect(sha256Hex(r.revealedSecret)).toBe(meta.commitHash);
    expect(r.variants[0]).toBe('STANDARD');
    expect(r.variants[1]).not.toBe(r.variants[2]);
  });

  it('a full tick after lock time hands off to Day 2', async () => {
    await tick(env.deps); // generate ahead
    await build();
    const meta = (await readMeta(env.store, dayId))!;
    env.clock.t = meta.locksAt + 1;
    const rep = await tick(env.deps);
    expect(rep.stages).toEqual(['OPEN→LOCKED', 'LOCKED→RESOLVED', 'RESOLVED→COMMENTED', 'COMMENTED→HANDED_OFF']);
    const cur = (await env.store.get(K.current))!;
    const m2 = (await readMeta(env.store, cur))!;
    expect(m2.dayNumber).toBe(2);
    expect(m2.status).toBe('OPEN');
    expect(m2.title).toMatch(/^Chaos Engine · Day 2 · /);
    expect(env.reddit.posts.map((p) => p.title)).toHaveLength(2);
    expect(env.reddit.comments.get(meta.postId!)?.[0]?.body).toMatch(/Chaos Engine · Day 1 results$/);
  });
});
