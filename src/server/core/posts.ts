/**
 * Reddit objects with crash-safe de-duplication (§2.1): store an attempt marker before calling
 * Reddit; on retry, search for the deterministic marker before creating anything.
 */
import { dayTitleMarker } from '../../shared/day';
import { hasResultsMarker } from '../../shared/results';
import type { Deps, RedditCommentRef, RedditPostRef } from './deps';
import { encodeMeta, readMeta } from './day';
import { K } from './keys';

export const POST_SEARCH_LIMIT = 50;

export const titleHasMarker = (title: string, n: number): boolean => title === dayTitleMarker(n) || title.startsWith(`${dayTitleMarker(n)} ·`);

async function recordDupes(deps: Deps, kind: 'post' | 'comment', dayNumber: number, extras: Array<{ id: string; createdAt: number }>): Promise<void> {
  for (const e of extras) await deps.store.zAdd(K.dupes, { member: JSON.stringify({ kind, dayNumber, id: e.id }), score: e.createdAt });
  if (extras.length) deps.log('warn', `found ${extras.length} duplicate ${kind}(s) for Day ${dayNumber}`);
}

/** Ensure the Day has its Reddit post. Returns false if the stage must be retried later. */
export async function ensureDayPost(deps: Deps, dayId: string, textFallback: string): Promise<boolean> {
  const meta = await readMeta(deps.store, dayId);
  if (!meta) return false;
  if (meta.postId) return true;
  const n = meta.dayNumber;
  if (meta.postAttemptAt) {
    let found: RedditPostRef[];
    try {
      const app = await deps.reddit.appUsername();
      found = (await deps.reddit.newPosts(POST_SEARCH_LIMIT)).filter((p) => p.authorName === app && titleHasMarker(p.title, n));
    } catch (e) {
      deps.log('warn', `post search failed for Day ${n}; will retry`, String(e));
      return false; // never create when the search itself failed
    }
    if (found.length) {
      found.sort((a, b) => a.createdAt - b.createdAt);
      await adoptPost(deps, dayId, found[0]!.id);
      await recordDupes(deps, 'post', n, found.slice(1));
      return true;
    }
  }
  await deps.store.hSet(K.meta(dayId), encodeMeta({ postAttemptAt: deps.now() }));
  try {
    const post = await deps.reddit.submitDayPost({ title: meta.title, textFallback });
    await adoptPost(deps, dayId, post.id);
    return true;
  } catch (e) {
    deps.log('warn', `post creation failed for Day ${n}; will search before retrying`, String(e));
    return false;
  }
}

async function adoptPost(deps: Deps, dayId: string, postId: string): Promise<void> {
  await deps.store.set(K.post(postId), dayId);
  await deps.store.hSet(K.meta(dayId), { postId });
}

/** Ensure the results comment exists. Returns false if the stage must be retried later. */
export async function ensureResultsComment(deps: Deps, dayId: string, body: string): Promise<boolean> {
  const meta = await readMeta(deps.store, dayId);
  if (!meta) return false;
  if (meta.resultsCommentId) return true;
  if (!meta.postId) {
    deps.log('warn', `Day ${meta.dayNumber} has no post; skipping its results comment`);
    await deps.store.hSet(K.meta(dayId), { resultsCommentId: 'none' });
    return true;
  }
  const n = meta.dayNumber;
  if (meta.commentAttemptAt) {
    let found: RedditCommentRef[];
    try {
      const app = await deps.reddit.appUsername();
      found = (await deps.reddit.postComments(meta.postId, 100)).filter((c) => c.authorName === app && hasResultsMarker(c.body, n));
    } catch (e) {
      deps.log('warn', `comment search failed for Day ${n}; will retry`, String(e));
      return false;
    }
    if (found.length) {
      found.sort((a, b) => a.createdAt - b.createdAt);
      await deps.store.hSet(K.meta(dayId), { resultsCommentId: found[0]!.id });
      await recordDupes(deps, 'comment', n, found.slice(1));
      return true;
    }
  }
  await deps.store.hSet(K.meta(dayId), encodeMeta({ commentAttemptAt: deps.now() }));
  try {
    const c = await deps.reddit.submitResultsComment(meta.postId, body);
    await deps.store.hSet(K.meta(dayId), { resultsCommentId: c.id });
    return true;
  } catch (e) {
    deps.log('warn', `results comment failed for Day ${n}; will search before retrying`, String(e));
    return false;
  }
}
