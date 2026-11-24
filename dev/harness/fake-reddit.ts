import type { RedditCommentRef, RedditPort, RedditPostRef } from '../../src/server/core/deps';

/** In-memory Reddit used by the harness and tests. */
export class FakeReddit implements RedditPort {
  posts: RedditPostRef[] = [];
  comments = new Map<string, RedditCommentRef[]>();
  private seq = 0;
  /** Test hooks: throw from the named call. */
  fail: Partial<Record<'submitDayPost' | 'submitResultsComment' | 'newPosts' | 'postComments', boolean>> = {};
  /** Test hook: create the object, then throw (simulates a lost response). */
  failAfterCreate: Partial<Record<'submitDayPost' | 'submitResultsComment', boolean>> = {};

  constructor(
    private clock: () => number = () => Date.now(),
    private appName = 'chaos-engine',
  ) {}

  snapshot(): string {
    return JSON.stringify({ posts: this.posts, comments: [...this.comments.entries()], seq: this.seq });
  }
  restore(json: string): void {
    const d = JSON.parse(json) as { posts: RedditPostRef[]; comments: Array<[string, RedditCommentRef[]]>; seq: number };
    this.posts = d.posts;
    this.comments = new Map(d.comments);
    this.seq = d.seq;
  }

  async appUsername(): Promise<string> {
    return this.appName;
  }
  async submitDayPost({ title }: { title: string; textFallback: string }): Promise<RedditPostRef> {
    if (this.fail.submitDayPost) throw new Error('injected: submitDayPost');
    const p: RedditPostRef = { id: `t3_${(++this.seq).toString(36)}`, title, authorName: this.appName, createdAt: this.clock() };
    this.posts.push(p);
    if (this.failAfterCreate.submitDayPost) throw new Error('injected: submitDayPost lost response');
    return p;
  }
  async submitResultsComment(postId: string, body: string): Promise<RedditCommentRef> {
    if (this.fail.submitResultsComment) throw new Error('injected: submitResultsComment');
    const c: RedditCommentRef = { id: `t1_${(++this.seq).toString(36)}`, body, authorName: this.appName, createdAt: this.clock() };
    const list = this.comments.get(postId) ?? [];
    list.push(c);
    this.comments.set(postId, list);
    if (this.failAfterCreate.submitResultsComment) throw new Error('injected: submitResultsComment lost response');
    return c;
  }
  async newPosts(limit: number): Promise<RedditPostRef[]> {
    if (this.fail.newPosts) throw new Error('injected: newPosts');
    return [...this.posts].reverse().slice(0, limit);
  }
  async postComments(postId: string, limit: number): Promise<RedditCommentRef[]> {
    if (this.fail.postComments) throw new Error('injected: postComments');
    return (this.comments.get(postId) ?? []).slice(0, limit);
  }
  postUrl(postId: string): string {
    return `https://www.reddit.com/r/chaosengine_dev/comments/${postId.replace(/^t3_/, '')}`;
  }
}
