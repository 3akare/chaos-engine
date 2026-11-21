/** Typed fetch to /api/*. Knows nothing about the harness. */
import type { ApiError, DayView, PlaceRequest, PredictRequest } from '../../shared/protocol';

export type Result<T> = { ok: true; data: T } | { ok: false; error: ApiError };

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Result<T>> {
  try {
    const res = await fetch(path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : null,
    });
    const json = (await res.json()) as T & Partial<ApiError>;
    if (!res.ok || json.error) return { ok: false, error: { error: json.error ?? 'BAD_REQUEST', message: json.message ?? 'Something went wrong. Try again.' } };
    return { ok: true, data: json };
  } catch {
    return { ok: false, error: { error: 'BUSY', message: "Couldn't reach the machine. Check your connection and try again." } };
  }
}

const q = (postId: string | undefined): string => (postId ? `?postId=${encodeURIComponent(postId)}` : '');

export const api = {
  state: (postId?: string) => call<DayView>('GET', `/api/state${q(postId)}`),
  place: (req: PlaceRequest) => call<{ ok: true; verdict: string; state: DayView }>('POST', '/api/place', req),
  remove: (postId?: string) => call<{ ok: true; verdict: string; state: DayView }>('POST', '/api/remove', { postId }),
  predict: (req: PredictRequest) => call<{ ok: true; state: DayView }>('POST', '/api/predict', req),
  ackInbox: (postId?: string) => call<{ ok: true }>('POST', '/api/inbox/ack', { postId }),
};
