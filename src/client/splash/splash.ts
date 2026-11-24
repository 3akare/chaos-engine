/** Inline feed card (§7.1). Plain TS + canvas — no Phaser. */
import { context, requestExpandedMode } from '@devvit/web/client';
import { api } from '../lib/api';
import { el, renderCard } from './card';
import './splash.css';

const qs = new URLSearchParams(location.search);
const theme = qs.get('theme');
if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;

const root = document.getElementById('splash')!;
const postId = context.postId ?? qs.get('postId') ?? undefined;

async function main(): Promise<void> {
  const r = await api.state(postId);
  if (!r.ok) {
    root.classList.add('ce-card');
    root.replaceChildren(el('div', 'info', el('div', 'brand', 'Chaos Engine'), el('div', 'title', 'Build together. Let chaos take over.'), el('div', 'muted', r.error.message)));
    return;
  }
  renderCard(root, r.data, (e) => requestExpandedMode(e as MouseEvent, 'game'));
}
void main();
