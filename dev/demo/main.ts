/** Browser playtest: a fake subreddit feed and the real game, with the real server running in-page. */
import type { DayView } from '../../src/shared/protocol';
import { renderCard } from '../../src/client/splash/card';
import { boot, call, nextDay, now, persist, reddit, resetAll, seedDemo, state } from './backend';
import { openPost } from './devvit-client';
import './demo.css';

const PLAYERS = ['you', 'alice', 'bob', 'carol', 'dave'];

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: Array<Node | string>): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...kids);
  return e;
}

function note(text: string): void {
  const n = h('div', { class: 'demo-note', role: 'status' }, text);
  document.body.append(n);
  setTimeout(() => n.remove(), 3200);
}

function playerPicker(): HTMLElement {
  const sel = h('select', { id: 'demo-player', 'aria-label': 'Playing as' });
  for (const p of PLAYERS) sel.append(new Option(`u/${p}`, p, false, p === state.user));
  sel.addEventListener('change', () => {
    state.user = sel.value;
    persist();
    location.reload();
  });
  return h('label', { class: 'demo-field' }, 'Playing as ', sel);
}

function button(label: string, onClick: () => void | Promise<void>, cls = ''): HTMLButtonElement {
  const b = h('button', { type: 'button', class: `demo-btn ${cls}` }, label);
  b.addEventListener('click', () => void onClick());
  return b;
}

const advance = async (): Promise<void> => {
  const stages = await nextDay();
  note(stages ? 'The machine fired. A new one is open.' : 'Nothing to resolve yet.');
  // Watch the results on the post that just resolved.
  const prev = reddit.posts.length >= 2 ? reddit.posts[reddit.posts.length - 2]!.id : undefined;
  if (prev && stages) openPost(prev);
  else location.reload();
};

async function renderFeed(): Promise<void> {
  const root = h('main', { class: 'feed' });
  const list = h('div', { class: 'posts' });
  root.append(
    h(
      'header',
      { class: 'feed-head' },
      h('div', { class: 'sub-name' }, 'r/chaos_engine_game_dev · playtest'),
      h('div', { class: 'demo-controls' }, playerPicker(), button('⏩ Next day', advance, 'primary'), button('Seed demo', async () => note(await seedDemo())), button('Start over', () => {
        resetAll();
        location.reload();
      })),
    ),
    list,
  );
  document.body.append(root);
  const posts = [...reddit.posts].reverse();
  for (const p of posts) {
    const card = h('div', { class: 'post-card' });
    const head = h('div', { class: 'post-head' }, h('b', {}, p.title), h('span', {}, `u/${p.authorName} · ${ago(now() - p.createdAt)}`));
    const wrap = h('article', { class: 'post' }, head, card);
    list.append(wrap);
    const res = await call('GET', `/api/state?postId=${p.id}`);
    if (res.ok) renderCard(card, (await res.json()) as DayView, () => openPost(p.id));
    card.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      openPost(p.id);
    });
  }
}

function ago(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const hr = Math.round(m / 60);
  return hr < 48 ? `${hr} h ago` : `${Math.round(hr / 24)} days ago`;
}

async function renderGame(): Promise<void> {
  const strip = h(
    'div',
    { class: 'demo-strip' },
    button('← Feed', () => {
      state.view = { screen: 'feed' };
      persist();
      location.reload();
    }),
    playerPicker(),
    button('⏩ Next day', advance, 'primary'),
  );
  document.body.append(strip, h('div', { id: 'app' }));
  document.body.classList.add('demo-game');
  await import('../../src/client/game/main');
}

async function start(): Promise<void> {
  await boot();
  if (state.view.screen === 'game' && state.view.postId) await renderGame();
  else await renderFeed();
}

void start();
