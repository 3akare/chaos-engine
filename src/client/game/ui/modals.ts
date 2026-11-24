/** Cards: welcome, how to play, "while you were away". Pictures first, few words. */
import type { InboxItem } from '../../../shared/protocol';
import { h, ico, showCard, spr } from './dom';

const playKey = (): HTMLElement => h('span', { class: 'mini-key' }, ico('right'));
const threeBalls = (): HTMLElement => h('span', { class: 'balls3' }, spr('ball'), spr('ball_grey'), spr('ball_green'));

const steps = (): HTMLElement =>
  h(
    'div',
    { class: 'rows' },
    h('div', { class: 'row' }, spr('flag_a'), h('span', {}, h('b', {}, 'Get the balls to the flag.'))),
    h('div', { class: 'row' }, spr('spot'), h('span', {}, 'Tap a ', h('b', {}, '+'), ' to add a ramp, spring or fan. Press ', playKey(), ' to roll; dots show where each ball went.')),
    h('div', { class: 'row' }, threeBalls(), h('span', {}, 'Three balls roll: ', h('b', {}, 'normal, heavy, bouncy'), '. Each one that makes it is a star.')),
  );

const modes = (): HTMLElement =>
  h(
    'div',
    { class: 'modes' },
    h('div', {}, h('b', {}, 'Solo'), h('span', {}, 'Your own machine. Stuck? Hints after 3 tries.')),
    h('div', {}, h('b', {}, 'Team'), h('span', {}, 'A different machine, built by everyone. Rolls at 02:00 UTC.')),
  );

export function welcome(onDone: () => void): void {
  showCard(h('div', {}, h('h2', {}, 'Chaos Engine'), h('h3', {}, 'Build of the Day'), steps(), modes()), 'Let’s go', onDone);
}

export function howToPlay(): void {
  showCard(
    h(
      'div',
      {},
      h('h2', {}, 'How to play'),
      steps(),
      modes(),
      h('h3', {}, 'The balls'),
      h(
        'div',
        { class: 'list' },
        h('div', {}, spr('ball'), h('span', {}, h('b', {}, 'Normal'), h('i', {}, 'The one you see the path for.'))),
        h('div', {}, spr('ball_grey'), h('span', {}, h('b', {}, 'Heavy'), h('i', {}, 'Fans push it less. Springs throw it lower.'))),
        h('div', {}, spr('ball_green'), h('span', {}, h('b', {}, 'Bouncy'), h('i', {}, 'Springs throw it higher.'))),
      ),
      h('h3', {}, 'The pieces'),
      h(
        'div',
        { class: 'list' },
        h('div', {}, spr('ramp'), h('span', {}, h('b', {}, 'Ramp'), h('i', {}, 'Sends the ball down and to the side.'))),
        h('div', {}, spr('spring_out'), h('span', {}, h('b', {}, 'Spring'), h('i', {}, 'Launches the ball up or in an arc.'))),
        h('div', {}, spr('fan_icon'), h('span', {}, h('b', {}, 'Fan'), h('i', {}, 'Blows the ball along, up to 3 squares.'))),
      ),
    ),
    'Got it',
  );
}

export function reportModal(items: InboxItem[], onDone: () => void): void {
  const shown = items.filter((i) => i.kind !== 'prediction').slice(0, 2);
  if (!shown.length) {
    onDone();
    return;
  }
  showCard(h('div', {}, h('h2', {}, 'While you were away'), ...shown.map((i) => h('p', { class: 'note' }, i.text))), 'OK', onDone);
}
