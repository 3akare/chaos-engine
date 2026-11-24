import { describe, expect, it } from 'vitest';
import { lockTimeFor } from '../src/server/core/pipeline';
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
});
