/** Board cards: welcome, help, the "while you were away" report, someone else's piece. */
import type { InboxItem } from '../../../shared/protocol';
import { VARIANTS } from '../../../shared/sim/variants';
import { h, showCard } from './dom';

const steps = (): HTMLElement =>
  h(
    'div',
    { class: 'rows' },
    h('div', { class: 'row' }, h('span', { class: 'glyph accent' }, h('span', { class: 'tri' })), 'Run the ball and watch it fail.'),
    h('div', { class: 'row' }, h('span', { class: 'glyph dimple' }), 'Tap a dimple to add a piece.'),
    h('div', { class: 'row' }, h('span', { class: 'glyph goal' }), 'Each night three balls fire. Guess how many make it.'),
  );

export function welcome(onDone: () => void): void {
  showCard(h('div', {}, h('h2', {}, 'Get the ball home'), steps()), 'Play', onDone);
}

export function howToPlay(): void {
  showCard(
    h('div', {}, h('h2', {}, 'How it works'), steps(), h('h3', {}, 'Surprise balls'), h('div', { class: 'list' }, ...VARIANTS.map((v) => h('div', {}, h('b', {}, v.name), h('span', {}, v.effect))))),
    'Got it',
  );
}

export function reportModal(items: InboxItem[], onDone: () => void): void {
  showCard(h('div', {}, h('h2', {}, 'While you were away'), ...items.slice(0, 2).map((i) => h('p', { class: 'note' }, i.text))), 'OK', onDone);
}
