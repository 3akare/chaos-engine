import { describe, expect, it } from 'vitest';
import { lockTimeFor, migrateSchedule, tick } from '../src/server/core/pipeline';
import { K } from '../src/server/core/keys';
import { readMeta } from '../src/server/core/day';
import { installWith, makeDeps } from './server-helpers';


describe('daily schedule: one new machine a day at 02:00 UTC', () => {
  it('a Day opened at the 02:00 hand-off locks 24 h later', () => {
    const t = Date.UTC(2026, 11, 1, 2, 0, 30);
    expect(lockTimeFor(t, 2)).toBe(Date.UTC(2026, 11, 2, 2));
  });
  it('a Day opened off-schedule runs at least 12 h (no second game the same day)', () => {
    const late = Date.UTC(2026, 11, 1, 23, 30); // install at 23:30
    expect(lockTimeFor(late, 2)).toBe(Date.UTC(2026, 11, 3, 2));
    const early = Date.UTC(2026, 11, 1, 10, 0);
    expect(lockTimeFor(early, 2)).toBe(Date.UTC(2026, 11, 2, 2));
  });
  it('new installs lock at 02:00 UTC', async () => {
    const env = makeDeps(Date.UTC(2026, 11, 7, 9));
    const id = await installWith(env);
    expect(new Date((await readMeta(env.store, id))!.locksAt).getUTCHours()).toBe(2);
  });
  it('existing installs on the old 12:00 schedule are moved once', async () => {
    const env = makeDeps(Date.UTC(2026, 11, 7, 9));
    const id = await installWith(env);
    await env.store.hSet(K.cfg, { resolveHourUtc: '12', scheduleVersion: '1' });
    await env.store.hSet(K.meta(id), { locksAt: String(Date.UTC(2026, 11, 7, 12)) });
    const rep = await tick(env.deps);
    expect(rep.stages).toContain('schedule→02:00 UTC');
    expect((await readMeta(env.store, id))!.locksAt).toBe(Date.UTC(2026, 11, 8, 2));
    expect(await migrateSchedule(env.deps)).toBe(false);
    // and the next Day after hand-off locks 24 h after its 02:00 opening
    env.clock.t = Date.UTC(2026, 11, 8, 2, 0, 5);
    await tick(env.deps);
    const cur = (await readMeta(env.store, (await env.store.get(K.current))!))!;
    expect(cur.dayNumber).toBe(2);
    expect(cur.locksAt).toBe(Date.UTC(2026, 11, 9, 2));
  });
});
