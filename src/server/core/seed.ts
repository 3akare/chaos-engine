/** Mod tool "Seed demo day" (§6.4): labelled setup pieces and fake predictions on the current Day. */
import type { StoredPiece } from '../../shared/protocol';
import { parseCell } from '../../shared/coords';
import type { Deps } from './deps';
import { currentDayId, newId, parseInventory, readMachine, readMeta } from './day';
import { K } from './keys';

export const SETUP_USER = 'setup';

export async function seedDemo(deps: Deps): Promise<string> {
  const { store } = deps;
  const id = await currentDayId(store);
  if (!id) return 'No Day is running yet.';
  const meta = await readMeta(store, id);
  if (!meta || meta.status !== 'OPEN') return 'The current Day is not open.';
  const machine = await readMachine(store, meta.dayNumber);
  if (!machine?.solution?.length) return 'This machine has no stored solution to seed from.';
  const app = await deps.reddit.appUsername();
  // Every solution piece except the one lowest on the board: Ball 1 visibly fails near the end,
  // and one more piece fixes it.
  const sol = [...machine.solution].sort((a, b) => parseCell(b.socket)![1] - parseCell(a.socket)![1]);
  const setup = sol.slice(1);
  const inv = parseInventory(await store.hGetAll(K.inv(id)));
  const existing = await store.hGetAll(K.pieces(id));
  const now = deps.now();
  const writes: Record<string, string> = {};
  for (const s of setup) {
    if (existing[s.socket] || inv[s.type] <= 0) continue;
    inv[s.type]--;
    const p: StoredPiece = { pieceId: newId(deps), socket: s.socket, type: s.type, dir: s.dir, userId: SETUP_USER, username: app, placedAt: now, setup: true };
    writes[s.socket] = JSON.stringify(p);
  }
  if (Object.keys(writes).length) await store.hSet(K.pieces(id), writes);
  await store.hSet(K.inv(id), Object.fromEntries(Object.entries(inv).map(([k, v]) => [k, String(v)])));
  // A believable spread of predictions from demo accounts.
  const spread = [2, 6, 9, 4];
  const preds: Record<string, string> = {};
  let k = 0;
  spread.forEach((n, balls) => {
    for (let i = 0; i < n; i++) preds[`t2_demo${k++}`] = String(balls);
  });
  await store.hSet(K.pred(id), preds);
  return `Seeded Day ${meta.dayNumber}: ${Object.keys(writes).length} setup piece(s) and ${k} demo predictions.`;
}
