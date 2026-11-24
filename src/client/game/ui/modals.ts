/** Cards: welcome, how it works, "while you were away". Real board sprites, few words. */
import type { InboxItem } from '../../../shared/protocol';
import { VARIANTS } from '../../../shared/sim/variants';
import { h, showCard, spr } from './dom';

const steps = (): HTMLElement =>
  h(
    'div',
    { class: 'rows' },
    h('div', { class: 'row' }, spr('ball'), 'Press play and watch the ball roll.'),
    h('div', { class: 'row' }, spr('spot'), 'Tap a + to add a spring, ramp or booster.'),
    h('div', { class: 'row' }, spr('flag_a'), 'Get it to the flag. At night 3 balls roll: guess how many make it.'),
  );

export function welcome(onDone: () => void): void {
  showCard(h('div', {}, h('h2', {}, 'Chaos Engine'), steps()), 'Play', onDone);
}

export function howToPlay(): void {
  showCard(
    h('div', {}, h('h2', {}, 'How it works'), steps(), h('h3', {}, 'Tonight’s surprise balls'), h('div', { class: 'list' }, ...VARIANTS.map((v) => h('div', {}, h('b', {}, v.name), h('span', {}, v.effect))))),
    'Got it',
  );
}

export function reportModal(items: InboxItem[], onDone: () => void): void {
  showCard(h('div', {}, h('h2', {}, 'While you were away'), ...items.slice(0, 2).map((i) => h('p', { class: 'note' }, i.text))), 'OK', onDone);
}
