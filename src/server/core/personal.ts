/** Solo mode progress (called "personal" in code): each player's best on each level, so it follows them between devices. */
import { LEVELS } from '../../shared/pour/levels';
import { BALLS } from '../../shared/pour/types';
import type { ApiError, PersonalResult } from '../../shared/protocol';
import type { Deps } from './deps';
import { K } from './keys';

export async function readPersonal(deps: Deps, userId: string | null): Promise<(number | null)[]> {
  const h = userId ? await deps.store.hGetAll(K.personal(userId)) : {};
  return LEVELS.map((_, i) => (h[String(i)] !== undefined ? Number(h[String(i)]) : null));
}

/** Keep the higher of the stored and the new score. Nothing here is ranked, so the phone's count is kept. */
export async function recordPersonal(deps: Deps, userId: string, level: unknown, claimed: unknown): Promise<PersonalResult | ApiError> {
  const i = Number(level);
  if (!Number.isInteger(i) || i < 0 || i >= LEVELS.length) return { error: 'BAD_REQUEST', message: "That level doesn't exist." };
  const n = Math.max(0, Math.min(BALLS, Math.floor(Number(claimed) || 0)));
  const prev = await deps.store.hGet(K.personal(userId), String(i));
  if (prev === undefined || n > Number(prev)) await deps.store.hSet(K.personal(userId), { [String(i)]: String(n) });
  return { personal: await readPersonal(deps, userId) };
}
