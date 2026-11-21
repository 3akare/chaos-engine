import type { ApiError } from '../../shared/protocol';
import type { Deps } from './deps';
import { readMeta } from './day';
import { K } from './keys';
import { TX_RETRIES } from './placement';

/** Predict the Day's score (0–3), changeable until lock (§2.7). */
export async function predict(deps: Deps, dayId: string, userId: string, balls: number): Promise<{ ok: true } | ApiError> {
  if (!Number.isInteger(balls) || balls < 0 || balls > 3) return { error: 'BAD_REQUEST', message: 'Pick 0, 1, 2 or 3 balls.' };
  for (let i = 0; i < TX_RETRIES; i++) {
    const tx = await deps.store.watch(K.meta(dayId));
    const meta = await readMeta(deps.store, dayId);
    if (!meta || meta.status !== 'OPEN') {
      await tx.unwatch();
      return { error: 'LOCKED', message: 'Predictions closed when the machine locked.' };
    }
    await tx.multi();
    await tx.hSet(K.pred(dayId), { [userId]: String(balls) });
    if ((await tx.exec()) !== null) return { ok: true };
  }
  return { error: 'BUSY', message: 'Busy machine — try again.' };
}
