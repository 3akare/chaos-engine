/**
 * Harness stand-in for `@devvit/web/client`. Aliased in by the harness Vite
 * config only; production builds use the real module.
 */
const qs = new URLSearchParams(location.search);
const cookie = (name: string): string | undefined =>
  document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1);

export const context = {
  postId: qs.get('postId') ?? undefined,
  username: cookie('ce_user') ?? 'alice',
  userId: `t2_${cookie('ce_user') ?? 'alice'}`,
  subredditName: 'chaosengine_dev',
};

export function requestExpandedMode(_e: Event, entry: string): void {
  location.href = `/${entry}.html${location.search}`;
}

export function exitExpandedMode(_e: Event): void {
  location.href = `/splash.html${location.search}`;
}

export function navigateTo(url: string | { url: string }): void {
  const u = typeof url === 'string' ? url : url.url;
  const m = /comments\/([a-z0-9_]+)/i.exec(u);
  if (m && window.parent !== window) {
    window.parent.postMessage({ type: 'harness:navigate', postId: m[1] }, '*');
    return;
  }
  location.href = u;
}

export function showToast(text: string | { text: string }): void {
  const t = typeof text === 'string' ? text : text.text;
  const el = document.createElement('div');
  el.textContent = t;
  el.style.cssText =
    'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#222;color:#fff;padding:10px 14px;border-radius:10px;z-index:9999;font:14px system-ui';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

export function getWebViewMode(): 'inline' | 'expanded' {
  return location.pathname.includes('game') ? 'expanded' : 'inline';
}
