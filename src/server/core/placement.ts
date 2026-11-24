/** Transactional place / move / replace / remove (§2.5, §6.4). */
import { cellName, parseCell } from '../../shared/coords';
import type { ApiError, InboxItem, StoredPiece } from '../../shared/protocol';
import { decide, holdersFrom, pieceName, type Action, type BoardState } from '../../shared/rules/placement';
import type { Machine } from '../../shared/types';
import { levelOf } from '../../shared/sim/board';
import type { Deps } from './deps';
import { newId, parseInventory, parsePieces, readMachine, readMeta } from './day';
import { K } from './keys';

export const TX_RETRIES = 5;

export type PlacementLogEntry = {
  id: string;
  kind: string;
  pieceId: string;
  userId: string;
  username: string;
  socket: string;
  type: string;
  at: number;
  raised: boolean;
  setup: boolean;
  displaced?: { userId: string; username: string; type: string };
};

/** Pieces today's fix needs: the stored solution's size (tier + 1 for machines without one). */
export function piecesNeeded(m: Machine): number {
  return m.solution?.length || (m.gen?.tier ?? 1) + 1;
}

export type ActionOutcome = { ok: true; verdict: string; kind: string } | ApiError;

export async function applyAction(deps: Deps, dayId: string, actor: { userId: string; username: string }, action: Action): Promise<ActionOutcome> {
  const { store } = deps;
  for (let attempt = 0; attempt < TX_RETRIES; attempt++) {
    const tx = await store.watch(K.meta(dayId), K.pieces(dayId), K.inv(dayId), K.holder(dayId));
    const meta = await readMeta(store, dayId);
    if (!meta) {
      await tx.unwatch();
      return { error: 'NO_DAY', message: "This machine doesn't exist any more." };
    }
    // Lock time is the deadline even before the cron has flipped the status (§2.1).
    if (meta.status !== 'OPEN' || deps.now() >= meta.locksAt) {
      await tx.unwatch();
      return { error: 'LOCKED', message: 'The machine is locked — the balls are firing. Check back for the results.' };
    }
    const machine = await readMachine(store, meta.dayNumber);
    if (!machine) {
      await tx.unwatch();
      return { error: 'NO_DAY', message: "Today's machine is still being built. Try again in a minute." };
    }
    const [piecesH, invH, holderH] = await Promise.all([store.hGetAll(K.pieces(dayId)), store.hGetAll(K.inv(dayId)), store.hGetAll(K.holder(dayId))]);
    void holderH;
    const pieces = parsePieces(piecesH);
    const state: BoardState = { pieces, inventory: parseInventory(invH), holders: holdersFrom(pieces) };
    const now = deps.now();
    const d = decide(levelOf(machine), state, actor, action, now, newId(deps), { piecesNeeded: piecesNeeded(machine) });
    if (!d.ok) {
      await tx.unwatch();
      return { error: d.code, message: d.message };
    }

    await tx.multi();
    // pieces: delete sockets that emptied, write the new piece.
    const delSockets = Object.keys(state.pieces).filter((s) => !d.next.pieces[s]);
    if (delSockets.length) await tx.hDel(K.pieces(dayId), delSockets);
    if (d.piece) await tx.hSet(K.pieces(dayId), { [d.piece.socket]: JSON.stringify(d.piece) });
    await tx.hSet(K.inv(dayId), Object.fromEntries(Object.entries(d.next.inventory).map(([k, v]) => [k, String(v)])));
    // Holder index: userId → JSON list of sockets, rewritten for everyone this action touched.
    const delHolders = Object.keys(holderH).filter((u) => d.next.holders[u] === undefined);
    if (delHolders.length) await tx.hDel(K.holder(dayId), delHolders);
    const setHolders: Record<string, string> = {};
    for (const [u, socks] of Object.entries(d.next.holders)) if (holderH[u] !== JSON.stringify(socks)) setHolders[u] = JSON.stringify(socks);
    if (Object.keys(setHolders).length) await tx.hSet(K.holder(dayId), setHolders);
    const entry: PlacementLogEntry = {
      id: newId(deps),
      kind: d.kind,
      pieceId: d.piece?.pieceId ?? d.own?.pieceId ?? '',
      userId: actor.userId,
      username: actor.username,
      socket: d.piece?.socket ?? d.own?.socket ?? '',
      type: d.piece?.type ?? d.own?.type ?? '',
      at: now,
      raised: d.raised,
      setup: false,
    };
    if (d.displaced) entry.displaced = { userId: d.displaced.userId, username: d.displaced.username, type: d.displaced.type };
    await tx.zAdd(K.events(dayId), { member: JSON.stringify(entry), score: now });
    if (d.displaced && !d.displaced.setup) {
      const item: InboxItem = {
        id: newId(deps),
        at: now,
        kind: 'replaced',
        dayNumber: meta.dayNumber,
        text: `u/${actor.username} replaced your ${pieceName(d.displaced.type)} at ${d.displaced.socket} with a better one. You're free to place again.`,
      };
      await tx.zAdd(K.inbox(d.displaced.userId), { member: JSON.stringify(item), score: now });
    }
    if (d.kind === 'place' || d.kind === 'replace') await tx.hIncrBy(K.userStats(actor.userId), 'placed', 1);
    const res = await tx.exec();
    if (res !== null) return { ok: true, verdict: d.verdict.text, kind: d.kind };
  }
  return { error: 'BUSY', message: 'Busy machine — lots of engineers at once. Try again.' };
}

/** Moderator override (§6.4 "Remove piece…"): remove whatever sits at a cell, return it to stock. */
export async function modRemove(deps: Deps, dayId: string, cell: string): Promise<string> {
  const { store } = deps;
  const c = parseCell(cell);
  if (!c) return `${cell} isn't a cell. Use a coordinate like C7.`;
  const name = cellName(c[0], c[1]);
  for (let attempt = 0; attempt < TX_RETRIES; attempt++) {
    const tx = await store.watch(K.pieces(dayId), K.inv(dayId), K.holder(dayId));
    const raw = await store.hGet(K.pieces(dayId), name);
    if (!raw) {
      await tx.unwatch();
      return `There's no piece at ${name}.`;
    }
    const p = JSON.parse(raw) as StoredPiece;
    const inv = parseInventory(await store.hGetAll(K.inv(dayId)));
    const meta = await readMeta(store, dayId);
    await tx.multi();
    await tx.hDel(K.pieces(dayId), [name]);
    await tx.hSet(K.inv(dayId), { [p.type]: String(inv[p.type] + 1) });
    if (!p.setup) {
      const rest = Object.values(parsePieces(await store.hGetAll(K.pieces(dayId)))).filter((q) => q.userId === p.userId && !q.setup && q.socket !== name).map((q) => q.socket).sort();
      if (rest.length) await tx.hSet(K.holder(dayId), { [p.userId]: JSON.stringify(rest) });
      else await tx.hDel(K.holder(dayId), [p.userId]);
    }
    if (!p.setup) {
      const item: InboxItem = { id: newId(deps), at: deps.now(), kind: 'removed', dayNumber: meta?.dayNumber ?? 0, text: `A moderator removed your ${pieceName(p.type)} at ${name}. You're free to place again.` };
      await tx.zAdd(K.inbox(p.userId), { member: JSON.stringify(item), score: deps.now() });
    }
    if ((await tx.exec()) !== null) return `Removed ${p.setup ? 'the setup' : `u/${p.username}'s`} ${pieceName(p.type)} at ${name}.`;
  }
  return 'Busy machine — try again.';
}
