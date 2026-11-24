/** GET /api/state: assemble a DayView. The secret and the solution never leave this file while OPEN. */
import type { DayResult, DayView, InboxItem } from '../../shared/protocol';
import type { Deps, RequestCtx } from './deps';
import { currentDayId, dayIdForPost, parseInventory, parsePieces, readMachine, readMeta, readSubStats, readUserStats } from './day';
import { K } from './keys';
import { ensureSoloMachine, publicMachine } from './levels';
import { allowanceFor } from '../../shared/rules/placement';
import { piecesNeeded } from './placement';
import { soloStats } from './solo';

export const INBOX_SHOWN = 10;

/** Unseen report items (newer than the user's lastSeenTs), newest first. */
export async function readInbox(deps: Deps, userId: string): Promise<InboxItem[]> {
  const lastSeen = Number((await deps.store.hGet(K.userStats(userId), 'lastSeenTs')) ?? 0);
  const items = await deps.store.zRange(K.inbox(userId), lastSeen + 1, Number.MAX_SAFE_INTEGER, { by: 'score' });
  return items
    .map((m) => JSON.parse(m.member) as InboxItem)
    .reverse()
    .slice(0, INBOX_SHOWN);
}

export async function ackInbox(deps: Deps, userId: string): Promise<void> {
  await deps.store.hSet(K.userStats(userId), { lastSeenTs: String(deps.now()) });
}

export async function buildView(deps: Deps, ctx: RequestCtx, postId: string | undefined): Promise<DayView | null> {
  const { store } = deps;
  const dayId = await dayIdForPost(store, postId);
  if (!dayId) return null;
  const meta = await readMeta(store, dayId);
  if (!meta) return null;
  const machine = await readMachine(store, meta.dayNumber);
  if (!machine) return null;
  const soloMachine = await ensureSoloMachine(deps, meta.dayNumber, meta.openedAt);
  const [piecesH, invH, holderH, predH] = await Promise.all([
    store.hGetAll(K.pieces(dayId)),
    store.hGetAll(K.inv(dayId)),
    store.hGetAll(K.holder(dayId)),
    store.hGetAll(K.pred(dayId)),
  ]);
  const piecesMap = parsePieces(piecesH);
  const pieces = Object.values(piecesMap).sort((a, b) => a.placedAt - b.placedAt);
  const resolved = meta.status === 'RESOLVED' || meta.status === 'COMMENTED' || meta.status === 'HANDED_OFF';
  let result: DayResult | null = null;
  if (resolved) {
    const raw = await store.get(K.result(dayId));
    if (raw) result = JSON.parse(raw) as DayResult;
  }
  const histogram: [number, number, number, number] = [0, 0, 0, 0];
  for (const v of Object.values(predH)) {
    const n = Number(v);
    if (n >= 0 && n <= 3) histogram[n]!++;
  }
  const userId = ctx.userId ?? null;
  void holderH;
  const mineSockets = userId ? pieces.filter((p) => p.userId === userId && !p.setup).map((p) => p.socket) : [];
  const [inbox, stats, sub, solo] = await Promise.all([
    userId ? readInbox(deps, userId) : Promise.resolve([]),
    userId ? readUserStats(store, userId) : readUserStats(store, '-'),
    readSubStats(store),
    soloStats(deps, dayId, userId),
  ]);

  // Newest Day (for "Build today's machine →") and yesterday's score.
  const curId = await currentDayId(store);
  const cur = curId ? await readMeta(store, curId) : null;
  let yesterday: DayView['yesterday'] = null;
  const prevId = await store.get(K.dayByNumber(meta.dayNumber - 1));
  if (prevId) {
    const raw = await store.get(K.result(prevId));
    if (raw) yesterday = { dayNumber: meta.dayNumber - 1, score: (JSON.parse(raw) as DayResult).score };
  }

  return {
    day: {
      dayId,
      dayNumber: meta.dayNumber,
      status: meta.status,
      openedAt: meta.openedAt,
      locksAt: meta.locksAt,
      commitHash: meta.commitHash,
      postId: meta.postId ?? null,
      title: meta.title,
    },
    level: publicMachine(machine),
    soloLevel: publicMachine(soloMachine),
    pieces,
    inventory: parseInventory(invH),
    me: {
      userId,
      username: ctx.username ?? null,
      socket: mineSockets[0] ?? null,
      sockets: mineSockets,
      allowance: allowanceFor(piecesMap, userId ?? '-', piecesNeeded(machine)),
      piecesNeeded: piecesNeeded(machine),
      prediction: userId && predH[userId] !== undefined ? Number(predH[userId]) : null,
      inbox,
      stats,
    },
    counts: {
      builders: new Set(pieces.filter((p) => !p.setup).map((p) => p.userId)).size,
      predictors: Object.keys(predH).length,
      histogram: resolved ? histogram : null,
    },
    solo,
    result,
    sub,
    current: { dayNumber: cur?.dayNumber ?? meta.dayNumber, postId: cur?.postId ?? null, url: cur?.postId ? deps.reddit.postUrl(cur.postId) : null },
    yesterday,
    serverNow: deps.now(),
  };
}
