/** Reading and writing Day records. */
import type { DayStatus, StoredPiece, SubStats, UserStats } from '../../shared/protocol';
import { PIECE_TYPES, type Machine, type PieceType } from '../../shared/types';
import type { Deps, StorePort } from './deps';
import { K } from './keys';

export type DayMeta = {
  dayId: string;
  dayNumber: number;
  status: DayStatus;
  openedAt: number;
  locksAt: number;
  lockedAt?: number;
  postId?: string;
  postAttemptAt?: number;
  commitHash: string;
  resultsCommentId?: string;
  commentAttemptAt?: number;
  nextDayId?: string;
  title: string;
};

const NUM = ['dayNumber', 'openedAt', 'locksAt', 'lockedAt', 'postAttemptAt', 'commentAttemptAt'] as const;

export function encodeMeta(m: Partial<DayMeta>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(m)) if (v !== undefined && v !== null) out[k] = String(v);
  return out;
}

export function decodeMeta(h: Record<string, string>): DayMeta | null {
  if (!h.dayId || !h.status) return null;
  const m: Record<string, unknown> = { ...h };
  for (const k of NUM) if (h[k] !== undefined) m[k] = Number(h[k]);
  return m as DayMeta;
}

export async function readMeta(store: StorePort, dayId: string): Promise<DayMeta | null> {
  return decodeMeta(await store.hGetAll(K.meta(dayId)));
}

export async function currentDayId(store: StorePort): Promise<string | null> {
  return (await store.get(K.current)) ?? null;
}

export async function dayIdForPost(store: StorePort, postId: string | undefined): Promise<string | null> {
  if (postId) {
    const d = await store.get(K.post(postId));
    if (d) return d;
  }
  return currentDayId(store);
}

const machineCache = new Map<string, Machine>();
/** Stored machine JSON for a day number (includes the solution — server only). */
export async function readMachine(store: StorePort, dayNumber: number): Promise<Machine | null> {
  const raw = await store.get(K.level(dayNumber));
  if (!raw) return null;
  const hit = machineCache.get(raw);
  if (hit) return hit;
  const m = JSON.parse(raw) as Machine;
  if (machineCache.size > 16) machineCache.clear();
  machineCache.set(raw, m);
  return m;
}

export function parsePieces(h: Record<string, string>): Record<string, StoredPiece> {
  const out: Record<string, StoredPiece> = {};
  for (const [sock, json] of Object.entries(h)) out[sock] = JSON.parse(json) as StoredPiece;
  return out;
}

export function parseInventory(h: Record<string, string>): Record<PieceType, number> {
  const inv = { RAMP: 0, SPRING: 0, FAN: 0, BUMPER: 0 } as Record<PieceType, number>;
  for (const t of PIECE_TYPES) inv[t] = Number(h[t] ?? 0);
  return inv;
}

export async function readSubStats(store: StorePort): Promise<SubStats> {
  const h = await store.hGetAll(K.sub);
  return { streak: Number(h.streak ?? 0), bestStreak: Number(h.bestStreak ?? 0), perfectDays: Number(h.perfectDays ?? 0), totalDays: Number(h.totalDays ?? 0) };
}

export async function readUserStats(store: StorePort, userId: string): Promise<UserStats> {
  const h = await store.hGetAll(K.userStats(userId));
  return {
    placed: Number(h.placed ?? 0),
    touchedInFinal: Number(h.touchedInFinal ?? 0),
    mvps: Number(h.mvps ?? 0),
    predStreak: Number(h.predStreak ?? 0),
    predBest: Number(h.predBest ?? 0),
  };
}

/** Random hex id for pieces, events, inbox items. */
export function newId(deps: Deps, bytes = 8): string {
  return [...deps.randomBytes(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
