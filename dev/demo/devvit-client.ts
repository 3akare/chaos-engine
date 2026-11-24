/** Stand-in for `@devvit/web/client` in the browser demo: "expanding" a post swaps to the game view. */
import { persist, state } from './backend';

export const context = {
  get postId(): string | undefined {
    return state.view.postId;
  },
  get username(): string {
    return state.user;
  },
  get userId(): string {
    return `t2_${state.user}`;
  },
  subredditName: 'chaos_engine_game_dev',
};

function go(screen: 'feed' | 'game', postId?: string): void {
  state.view = { screen, postId };
  persist();
  location.reload();
}

export function requestExpandedMode(_e: Event, _entry: string): void {
  go('game', state.view.postId);
}

export function openPost(postId: string): void {
  go('game', postId);
}

export function exitExpandedMode(_e?: Event): void {
  go('feed');
}

export function navigateTo(url: string | { url: string }): void {
  const u = typeof url === 'string' ? url : url.url;
  const m = /comments\/([a-z0-9_]+)/i.exec(u);
  if (m) go('game', m[1]!.startsWith('t3_') ? m[1] : `t3_${m[1]}`);
}

export function showToast(_t: unknown): void {}
export function getWebViewMode(): 'inline' | 'expanded' {
  return state.view.screen === 'game' ? 'expanded' : 'inline';
}
