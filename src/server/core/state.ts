/** GET /api/state: everything a card or the game screen needs about one Day. */
import type { DayResult, DayView } from '../../shared/protocol';
import type { Deps, RequestCtx } from './deps';
import { currentDayId, dayIdForPost, readMachine, readMeta, readSubStats, readUserStats } from './day';
import { bestBuild, ceilingOf, rankOf, readBest, readTotals, topEntries } from './board';
import { K } from './keys';
import { publicMachine } from './machines';
import { readPersonal } from './personal';
import { runPour } from '../../shared/pour/sim';
import type { Machine } from '../../shared/pour/types';

/**
 * The solution for a closed day: the machine's best known build and what it really catches on
 * that day's machine (later days reuse machines mirrored or with a new wobble, so the stored
 * number can't be trusted). Poured once, then kept.
 */
async function closedSolution(deps: Deps, dayId: string, machine: Machine): Promise<DayView['solution']> {
  const par = machine.gen?.par;
  if (!par) return null;
  const saved = await deps.store.get(K.solution(dayId));
  if (saved) return JSON.parse(saved) as DayView['solution'];
  const solution = { build: par, score: runPour(machine, par) };
  await deps.store.set(K.solution(dayId), JSON.stringify(solution));
  return solution;
}

export async function buildView(deps: Deps, ctx: RequestCtx, postId: string | undefined): Promise<DayView | null> {
  const { store } = deps;
  const dayId = await dayIdForPost(store, postId);
  if (!dayId) return null;
  const meta = await readMeta(store, dayId);
  if (!meta) return null;
  const machine = await readMachine(store, meta.dayNumber);
  if (!machine) return null;
  const userId = ctx.userId ?? null;
  const [best, rank, pours, stats, board, totals, sub] = await Promise.all([
    userId ? readBest(deps, dayId, userId) : Promise.resolve(null),
    userId ? rankOf(deps, dayId, userId) : Promise.resolve(null),
    userId ? store.hGet(K.pours(dayId), userId) : Promise.resolve(undefined),
    readUserStats(store, userId ?? '-'),
    topEntries(deps, dayId),
    readTotals(deps, dayId, ceilingOf(machine)),
    readSubStats(store),
  ]);
  const personal = await readPersonal(deps, userId);
  const rawResult = await store.get(K.result(dayId));
  const result = rawResult ? (JSON.parse(rawResult) as DayResult) : null;

  const curId = await currentDayId(store);
  const cur = curId ? await readMeta(store, curId) : null;
  let yesterday: DayView['yesterday'] = null;
  const prevId = await store.get(K.dayByNumber(meta.dayNumber - 1));
  if (prevId) {
    const raw = await store.get(K.result(prevId));
    if (raw) {
      const r = JSON.parse(raw) as DayResult;
      yesterday = { dayNumber: meta.dayNumber - 1, winner: r.winner?.username ?? null, score: r.winner?.score ?? 0 };
    }
  }

  return {
    day: { dayId, dayNumber: meta.dayNumber, status: meta.status, openedAt: meta.openedAt, locksAt: meta.locksAt, postId: meta.postId ?? null, title: meta.title },
    machine: publicMachine(machine),
    me: { userId, username: ctx.username ?? null, best: best?.s ?? null, build: best ? bestBuild(best) : null, rank, pours: Number(pours ?? 0), stats, personal },
    board,
    totals,
    result,
    sub,
    current: { dayNumber: cur?.dayNumber ?? meta.dayNumber, postId: cur?.postId ?? null, url: cur?.postId ? deps.reddit.postUrl(cur.postId) : null },
    yesterday,
    // The answer only once the day can no longer be played.
    solution: meta.status !== 'OPEN' && meta.status !== 'CREATING' ? await closedSolution(deps, dayId, machine) : null,
    serverNow: deps.now(),
  };
}
