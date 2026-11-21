import { beforeEach, describe, expect, it } from 'vitest';
import { applyAction } from '../src/server/core/placement';
import { lockDay, tick } from '../src/server/core/pipeline';
import { K } from '../src/server/core/keys';
import { readMeta } from '../src/server/core/day';
import { installWith, makeDeps, type TestEnv } from './server-helpers';

let env: TestEnv;
let day1: string;
beforeEach(async () => {
  env = makeDeps();
  day1 = await installWith(env);
  await tick(env.deps); // generate ahead (Days 2–3)
  const m = (await readMeta(env.store, day1))!;
  env.clock.t = m.locksAt + 1;
});

const finalCheck = async () => {
  const m1 = (await readMeta(env.store, day1))!;
  expect(m1.status).toBe('HANDED_OFF');
  const comments = env.reddit.comments.get(m1.postId!) ?? [];
  expect(comments.filter((c) => c.body.endsWith('Chaos Engine · Day 1 results'))).toHaveLength(1);
  expect(env.reddit.posts.filter((p) => p.title.startsWith('Chaos Engine · Day 2 ·'))).toHaveLength(1);
  const cur = (await readMeta(env.store, (await env.store.get(K.current))!))!;
  expect(cur.dayNumber).toBe(2);
  expect(cur.status).toBe('OPEN');
  expect(cur.postId).toBeDefined();
};

describe('pipeline recovery', () => {
  it('Reddit failing at the comment stage: stays RESOLVED, recovers next tick', async () => {
    env.reddit.fail.submitResultsComment = true;
    await tick(env.deps);
    expect((await readMeta(env.store, day1))!.status).toBe('RESOLVED');
    env.reddit.fail.submitResultsComment = false;
    await tick(env.deps);
    await finalCheck();
  });

  it('a lost comment response is adopted, not duplicated', async () => {
    env.reddit.failAfterCreate.submitResultsComment = true;
    await tick(env.deps);
    expect((await readMeta(env.store, day1))!.status).toBe('RESOLVED');
    env.reddit.failAfterCreate.submitResultsComment = false;
    await tick(env.deps);
    await finalCheck();
  });

  it('a lost post response is adopted, not duplicated', async () => {
    env.reddit.failAfterCreate.submitDayPost = true;
    await tick(env.deps);
    expect((await readMeta(env.store, day1))!.status).toBe('COMMENTED');
    env.reddit.failAfterCreate.submitDayPost = false;
    await tick(env.deps);
    await finalCheck();
  });

  it('if the duplicate search itself fails, nothing is created', async () => {
    env.reddit.failAfterCreate.submitDayPost = true;
    await tick(env.deps);
    env.reddit.failAfterCreate.submitDayPost = false;
    env.reddit.fail.newPosts = true;
    const posts = env.reddit.posts.length;
    await tick(env.deps);
    expect(env.reddit.posts.length).toBe(posts);
    env.reddit.fail.newPosts = false;
    await tick(env.deps);
    await finalCheck();
  });

  it('duplicates are adopted earliest-first and recorded for moderators', async () => {
    env.reddit.failAfterCreate.submitResultsComment = true;
    await tick(env.deps);
    // Simulate a second stray comment with the same marker.
    const postId = (await readMeta(env.store, day1))!.postId!;
    env.clock.t += 5;
    await env.reddit.submitResultsComment(postId, 'dupe\n\nChaos Engine · Day 1 results').catch(() => undefined);
    env.reddit.failAfterCreate.submitResultsComment = false;
    await tick(env.deps);
    expect((await readMeta(env.store, day1))!.resultsCommentId).toBe(env.reddit.comments.get(postId)![0]!.id);
    expect(await env.store.zCard(K.dupes)).toBe(1);
  });

  const storeFailures: Array<[string, (cmd: string, key: string) => boolean]> = [
    ['lock', (c, k) => c === 'hSet' && k.endsWith(':meta')],
    ['resolve', (c, k) => c === 'set' && k.endsWith(':result')],
    ['comment marker', (c, k) => c === 'hSet' && k.endsWith(':meta')],
    ['hand-off record', (c, k) => c === 'set' && k.startsWith('ce:daynum:2')],
    ['open next day', (c, k) => c === 'set' && k === 'ce:day:current'],
  ];
  for (const [name, pred] of storeFailures) {
    it(`a store failure during "${name}" is retried on the next tick`, async () => {
      let armed = true;
      let hits = 0;
      env.store.failOn = (c, k) => {
        if (!armed || !pred(c, k)) return false;
        hits++;
        // Let the first matching write through for stages that legitimately write the key earlier.
        return name === 'comment marker' ? hits === 3 : true;
      };
      await tick(env.deps);
      armed = false;
      await tick(env.deps);
      await tick(env.deps);
      await finalCheck();
    });
  }

  it('two overlapping ticks: only one advances (lease)', async () => {
    env.store.beforeExec = () => new Promise((r) => setImmediate(r));
    const [a, b] = await Promise.all([tick(env.deps), tick(env.deps)]);
    expect([a.ran, b.ran].filter(Boolean)).toHaveLength(1);
    env.store.beforeExec = undefined;
    await finalCheck();
  });

  it('a placement racing the lock is accepted before LOCKED or refused — never applied after', async () => {
    const m = (await readMeta(env.store, day1))!;
    env.clock.t = m.locksAt - 1;
    let locked = false;
    env.store.beforeExec = async () => {
      if (locked) return;
      locked = true;
      env.clock.t = m.locksAt + 1;
      await lockDay(env.deps, day1);
    };
    const r = await applyAction(env.deps, day1, { userId: 'a', username: 'alice' }, { kind: 'set', socket: 'I3', type: 'RAMP', dir: 'DL' });
    env.store.beforeExec = undefined;
    const meta = (await readMeta(env.store, day1))!;
    expect(meta.status).toBe('LOCKED');
    const pieces = await env.store.hGetAll(K.pieces(day1));
    if ('ok' in r && r.ok) {
      const ev = await env.store.zRange(K.events(day1), 0, -1);
      expect(ev[0]!.score).toBeLessThanOrEqual(meta.lockedAt!);
    } else {
      expect('error' in r && r.error).toBe('LOCKED');
      expect(Object.keys(pieces)).toHaveLength(0);
    }
  });
});
