/**
 * Browser playtest. Shows today's post exactly as it would sit in a subreddit, and opens the real
 * game when you tap it, with the real server running in the page. Only the post and the game are
 * part of the app; the folded "Playtest tools" at the bottom exist only here, for testing.
 */
import type { DayView } from '../../src/shared/protocol';
import { rememberMode, renderCard } from '../../src/client/splash/card';
import { boot, call, fillBoard, nextDay, persist, reddit, resetAll, state } from './backend';
import { openPost } from './devvit-client';
import { icon } from '../../src/client/assets';
import './demo.css';

const PLAYERS = ['you', 'alice', 'bob', 'carol', 'dave'];

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: Array<Node | string>): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...kids);
  return e;
}

function img(name: string): HTMLImageElement {
  const i = new Image();
  i.src = icon(name);
  i.alt = '';
  return i;
}

function note(text: string): void {
  const n = h('div', { class: 'demo-note', role: 'status' }, text);
  document.body.append(n);
  setTimeout(() => n.remove(), 3200);
}

function button(label: string, onClick: () => void | Promise<void>, cls = ''): HTMLButtonElement {
  const b = h('button', { type: 'button', class: `demo-btn ${cls}` }, label);
  b.addEventListener('click', () => void onClick());
  return b;
}

/** Testing only: switch player, end the day, add rivals, reset. Folded away by default. */
function tools(): HTMLElement {
  const sel = h('select', { id: 'demo-player', 'aria-label': 'Playing as' });
  for (const p of PLAYERS) sel.append(new Option(`u/${p}`, p, false, p === state.user));
  sel.addEventListener('change', () => {
    state.user = sel.value;
    persist();
    location.reload();
  });
  const prev = reddit.posts.length >= 2 ? reddit.posts[reddit.posts.length - 2]!.id : null;
  const box = h(
    'details',
    { class: 'demo-tools' },
    h('summary', {}, 'Playtest tools'),
    h('p', {}, 'Not part of the game. These are only here so you can test it.'),
    h('div', { class: 'demo-controls' }, h('label', { class: 'demo-field' }, 'Playing as ', sel)),
    h(
      'div',
      { class: 'demo-controls' },
      button('Add rival players', async () => {
        note(await fillBoard());
        setTimeout(() => location.reload(), 600);
      }),
      button('End the day now', async () => {
        const stages = await nextDay();
        note(stages ? 'Day over. A new machine is up.' : 'Nothing to end yet.');
        setTimeout(() => location.reload(), 600);
      }),
      ...(prev ? [button("Open yesterday's post", () => openPost(prev))] : []),
      button('Start over', () => {
        resetAll();
        location.reload();
      }),
    ),
  );
  if (state.toolsOpen) box.setAttribute('open', '');
  box.addEventListener('toggle', () => {
    state.toolsOpen = (box as HTMLDetailsElement).open;
    persist();
  });
  return box;
}

async function renderFeed(): Promise<void> {
  const root = h('main', { class: 'feed' });
  document.body.append(root);
  const p = reddit.posts[reddit.posts.length - 1];
  if (p) {
    const card = h('div', { class: 'post-card' });
    root.append(h('article', { class: 'post' }, h('div', { class: 'post-head' }, h('span', {}, 'r/yoursubreddit · u/chaos-engine-game'), h('b', {}, p.title)), card));
    const res = await call('GET', `/api/state?postId=${p.id}`);
    if (res.ok)
      renderCard(card, (await res.json()) as DayView, (_e, mode) => {
        rememberMode(mode);
        openPost(p.id);
      });
  }
  root.append(tools());
}

async function renderGame(): Promise<void> {
  document.body.classList.add('demo-game');
  document.body.append(h('div', { id: 'app' }));
  await import('../../src/client/game/main');
  // Stands in for Reddit's own close button.
  const back = h('button', { type: 'button', class: 'demo-back', 'aria-label': 'Back to the post' }, img('arrowLeft'), 'Back to the post');
  back.addEventListener('click', () => {
    state.view = { screen: 'feed' };
    persist();
    location.reload();
  });
  document.body.append(back);
}

async function start(): Promise<void> {
  await boot();
  if (state.view.screen === 'game' && state.view.postId) await renderGame();
  else await renderFeed();
}

void start();
