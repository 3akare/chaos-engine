import { describe, expect, it } from 'vitest';
import { install, lockTimeFor, tick } from '../src/server/core/pipeline';
import { currentDayId, readMeta } from '../src/server/core/day';
import { K } from '../src/server/core/keys';
import { installWith, makeDeps, TEST_MACHINE } from './server-helpers';

describe('daily schedule: one new machine a day at 02:00 UTC', () => {
  it('a Day opened at the 02:00 hand-off locks 24 h later', () => {
    const t = Date.UTC(2026, 11, 1, 2, 0, 30);
    expect(lockTimeFor(t, 2)).toBe(Date.UTC(2026, 11, 2, 2));
  });

  it('a first game opened off-schedule ends at the next 02:00, so the next game comes on time', () => {
    expect(lockTimeFor(Date.UTC(2026, 11, 1, 23, 30), 2)).toBe(Date.UTC(2026, 11, 2, 2));
    expect(lockTimeFor(Date.UTC(2026, 11, 1, 10, 0), 2)).toBe(Date.UTC(2026, 11, 2, 2));
    // Opened minutes before 02:00: it runs to the following 02:00 rather than a few minutes.
    expect(lockTimeFor(Date.UTC(2026, 11, 1, 1, 30), 2)).toBe(Date.UTC(2026, 11, 2, 2));
  });

  it('new installs lock at 02:00 UTC', async () => {
    const env = makeDeps(Date.UTC(2026, 11, 7, 9));
    const id = await installWith(env);
    expect(new Date((await readMeta(env.store, id))!.locksAt).getUTCHours()).toBe(2);
  });

  it('a fresh install posts its first game straight away', async () => {
    const env = makeDeps(Date.UTC(2026, 11, 7, 9));
    await installWith(env);
    expect(env.reddit.posts).toHaveLength(1);
  });

  it('an install or upgrade on a day that already had a game holds Day 1 until 02:00', async () => {
    const env = makeDeps(Date.UTC(2026, 11, 7, 9));
    // The app already posted a game this morning (say, from a version that kept its data elsewhere).
    env.clock.t = Date.UTC(2026, 11, 7, 3);
    await env.reddit.submitDayPost({ title: 'Chaos Engine · Day 4 · Old Machine', textFallback: '' });
    env.clock.t = Date.UTC(2026, 11, 7, 9);
    await env.store.set(K.level(1), JSON.stringify(TEST_MACHINE));
    expect(await install(env.deps)).toBeNull();
    expect(env.reddit.posts).toHaveLength(1);
    // Ticks through the day post nothing.
    env.clock.t = Date.UTC(2026, 11, 7, 20);
    await tick(env.deps);
    expect(env.reddit.posts).toHaveLength(1);
    // At 02:00 the game opens and posts, and runs a full day.
    env.clock.t = Date.UTC(2026, 11, 8, 2, 5);
    await tick(env.deps);
    expect(env.reddit.posts).toHaveLength(2);
    const meta = (await readMeta(env.store, (await currentDayId(env.store))!))!;
    expect(meta.status).toBe('OPEN');
    expect(meta.locksAt).toBe(Date.UTC(2026, 11, 9, 2));
  });

  it('when the post search fails, Day 1 waits for 02:00 rather than risk a second game', async () => {
    const env = makeDeps(Date.UTC(2026, 11, 7, 9));
    env.reddit.fail.newPosts = true;
    await env.store.set(K.level(1), JSON.stringify(TEST_MACHINE));
    expect(await install(env.deps)).toBeNull();
    expect(env.reddit.posts).toHaveLength(0);
    env.reddit.fail.newPosts = false;
    env.clock.t = Date.UTC(2026, 11, 8, 2, 1);
    await tick(env.deps);
    expect(env.reddit.posts).toHaveLength(1);
  });

  it('upgrades and repeated ticks never add a post the same day', async () => {
    const env = makeDeps(Date.UTC(2026, 11, 7, 9));
    await installWith(env);
    for (let h = 10; h < 26; h++) {
      env.clock.t = Date.UTC(2026, 11, 7, h);
      await tick(env.deps);
      await install(env.deps);
    }
    expect(env.reddit.posts).toHaveLength(1);
    env.clock.t = Date.UTC(2026, 11, 8, 2, 10);
    await tick(env.deps);
    expect(env.reddit.posts).toHaveLength(2);
  });
});
