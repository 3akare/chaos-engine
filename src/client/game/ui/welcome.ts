/** First open: three pictures, three short lines. */
import type { DayView } from '../../../shared/protocol';
import { h, showModal } from './dom';

const KEY = 'ce_welcome_v2';

export function welcomeSeen(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function welcome(_v: DayView, onDone: () => void): void {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* private mode */
  }
  showModal(
    h(
      'div',
      { class: 'howto' },
      h('h2', {}, 'Get the ball home'),
      h('div', { class: 'hrow' }, h('span', { class: 'hicon play' }, h('span', { class: 'tri sm' })), h('p', {}, 'Run it and watch it fail.')),
      h('div', { class: 'hrow' }, h('span', { class: 'hicon dimple' }), h('p', {}, 'Tap a dimple to add a piece.')),
      h('div', { class: 'hrow' }, h('span', { class: 'hicon goal' }), h('p', {}, 'Every night, three balls fire. Guess how many make it.')),
    ),
    onDone,
    'Play',
  );
}
