/** LOCKED → RESOLVED: freeze today's board, reveal the Build of the Day, update streaks. */
import type { DayResult } from '../../shared/protocol';
import type { Deps } from './deps';
import { readMachine, readMeta, readSubStats } from './day';
import { bestBuild, ceilingOf, readBest, readTotals, topEntries } from './board';
import { K } from './keys';

export async function resolveDay(deps: Deps, dayId: string): Promise<boolean> {
  const { store } = deps;
  const meta = await readMeta(store, dayId);
  if (!meta || meta.status !== 'LOCKED') return false;
  if (!(await store.get(K.result(dayId)))) {
    const top = await topEntries(deps, dayId, 10);
    const totals = await readTotals(deps, dayId, ceilingOf(await readMachine(store, meta.dayNumber)));
    const lead = await store.zRange(K.board(dayId), 0, 2, { reverse: true });
    const first = lead[0] ? await readBest(deps, dayId, lead[0].member) : null;
    const goalMet = totals.tier !== null;
    const sub = await readSubStats(store);
    const streak = goalMet ? sub.streak + 1 : 0;
    const result: DayResult = {
      top,
      winner: first ? { username: first.u, score: first.s, at: first.at, build: bestBuild(first) } : null,
      totals,
      goalMet,
      streak,
      lockedAt: meta.lockedAt ?? deps.now(),
    };
    // Stats first (idempotent enough: guarded by the result key being written last).
    await store.hSet(K.sub, {
      streak: String(streak),
      bestStreak: String(Math.max(sub.bestStreak, streak)),
      goalDays: String(sub.goalDays + (goalMet ? 1 : 0)),
      totalDays: String(sub.totalDays + 1),
    });
    for (const [i, m] of lead.entries()) {
      await store.hIncrBy(K.userStats(m.member), 'podiums', 1);
      if (i === 0) await store.hIncrBy(K.userStats(m.member), 'wins', 1);
    }
    const all = await store.hGetAll(K.best(dayId));
    for (const [userId, raw] of Object.entries(all)) if ((JSON.parse(raw) as { s: number }).s >= 100) await store.hIncrBy(K.userStats(userId), 'hundreds', 1);
    await store.set(K.result(dayId), JSON.stringify(result));
  }
  await store.hSet(K.meta(dayId), { status: 'RESOLVED' });
  return true;
}
