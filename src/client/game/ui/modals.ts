/** Cards: welcome, how to play, "while you were away". Pictures first, few words. */
import type { InboxItem } from '../../../shared/protocol';
import { VARIANTS } from '../../../shared/sim/variants';
import { BALL_SPRITE } from '../../assets';
import { h, ico, showCard, spr } from './dom';

const play = (): HTMLElement => h('span', { class: 'mini-key' }, ico('right'));

const steps = (): HTMLElement =>
  h(
    'div',
    { class: 'rows' },
    h('div', { class: 'row' }, spr('flag_a'), h('span', {}, h('b', {}, 'Get the ball to the flag.'))),
    h('div', { class: 'row' }, spr('spot'), h('span', {}, 'Tap a ', h('b', {}, '+'), ' to add a ramp, spring or fan. Press ', play(), ' to test.')),
    h('div', { class: 'row' }, spr('star'), h('span', {}, 'Everyone builds the same machine. Tonight 3 balls roll: each one that makes it is a star.')),
  );

export function welcome(onDone: () => void): void {
  showCard(h('div', {}, h('h2', {}, 'Chaos Engine'), steps()), 'Let’s go', onDone);
}

export function howToPlay(): void {
  showCard(
    h(
      'div',
      {},
      h('h2', {}, 'How to play'),
      steps(),
      h('h3', {}, 'The surprise balls'),
      h('div', { class: 'list' }, ...VARIANTS.filter((v) => v.id !== 'OFFSET_R').map((v) => h('div', {}, spr(BALL_SPRITE[v.id]), h('span', {}, h('b', {}, v.id === 'OFFSET_L' ? 'Lefty / Righty' : v.name), h('i', {}, v.id === 'OFFSET_L' ? 'Starts one step to the side.' : v.effect))))),
    ),
    'Got it',
  );
}

export function reportModal(items: InboxItem[], onDone: () => void): void {
  const shown = items.filter((i) => !/guess/i.test(i.text)).slice(0, 2);
  if (!shown.length) {
    onDone();
    return;
  }
  showCard(h('div', {}, h('h2', {}, 'While you were away'), ...shown.map((i) => h('p', { class: 'note' }, i.text))), 'OK', onDone);
}
