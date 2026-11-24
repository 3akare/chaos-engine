/** Small sheets and dialogs. Few words, big shapes. */
import type { DayView, InboxItem, StoredPiece } from '../../../shared/protocol';
import { VARIANTS } from '../../../shared/sim/variants';
import { h, showModal } from './dom';
import { pieceIcon } from './icons';

export function howToPlay(): void {
  showModal(
    h(
      'div',
      { class: 'howto' },
      h('h2', {}, 'How it works'),
      h('div', { class: 'hrow' }, h('span', { class: 'hicon play' }, h('span', { class: 'tri sm' })), h('p', {}, 'Run the ball. Watch where it fails.')),
      h('div', { class: 'hrow' }, h('span', { class: 'hicon dimple' }), h('p', {}, 'Tap a dimple to add a piece. Pieces can’t make it worse.')),
      h('div', { class: 'hrow' }, h('span', { class: 'hicon goal' }), h('p', {}, 'Every night three balls fire. Two are surprises.')),
      h('h3', {}, 'Surprise balls'),
      h('div', { class: 'variants' }, ...VARIANTS.map((v) => h('div', { class: 'vrow' }, h('b', {}, v.name), h('span', {}, v.effect)))),
    ),
    undefined,
    'Got it',
  );
}

export function reportModal(items: InboxItem[], onDone: () => void): void {
  showModal(h('div', {}, h('h2', {}, 'While you were away'), ...items.slice(0, 3).map((i) => h('p', { class: 'report' }, i.text))), onDone, 'Nice');
}

export function pieceCard(p: StoredPiece, _view: DayView, actions: Array<{ label: string; primary?: boolean; run: () => void }>): HTMLElement {
  const who = p.setup ? 'Starter piece' : `u/${p.username}`;
  return h(
    'div',
    { class: 'piececard' },
    pieceIcon(p.type, p.dir, 52),
    h('div', { class: 'who' }, h('b', {}, who), h('span', {}, p.type.toLowerCase())),
    ...actions.map((a) => h('button', { class: `pill-btn${a.primary ? ' primary' : ''}`, onclick: a.run }, a.label)),
  );
}
