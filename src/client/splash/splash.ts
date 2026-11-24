/** Inline feed card. Plain TS + canvas. */
import { context, requestExpandedMode } from '@devvit/web/client';
import { api } from '../lib/api';
import { el, renderCard } from './card';
import './splash.css';

const qs = new URLSearchParams(location.search);
const root = document.getElementById('splash')!;
const postId = context.postId ?? qs.get('postId') ?? undefined;

async function main(): Promise<void> {
  const r = await api.state(postId);
  if (!r.ok) {
    root.classList.add('ce-card');
    root.replaceChildren(el('div', 'info', el('div', 'title hud', 'Chaos Engine'), el('div', 'kicker', r.error.message)));
    return;
  }
  renderCard(root, r.data, (e) => requestExpandedMode(e as MouseEvent, 'game'));
}
void main();
