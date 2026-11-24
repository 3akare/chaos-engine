/** First-open welcome: what the game is, in three short steps. Shown once. */
import type { DayView } from '../../../shared/protocol';
import { h, showModal } from './dom';

const KEY = 'ce_welcome_v1';

export function welcomeSeen(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function welcome(v: DayView, onDone: () => void): void {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* private mode */
  }
  const goal = v.level.target === 'basket' ? 'the basket 🧺' : 'the bell 🔔';
  const step = (n: string, title: string, body: string) => h('div', { class: 'wstep' }, h('div', { class: 'wnum' }, n), h('div', {}, h('b', {}, title), h('div', { class: 'muted' }, body)));
  showModal(
    h(
      'div',
      { class: 'welcome' },
      h('h2', {}, 'Welcome to Chaos Engine'),
      h('p', {}, `Every day there's one broken machine, shared by the whole subreddit. Your job: get the ball into ${goal}.`),
      step('1', 'Watch it fail', 'Tap ▶ Test run to see where the ball goes wrong. Test as often as you like.'),
      step('2', 'Add pieces', 'Tap a dashed square to add a ramp, spring, fan or bumper. A piece can never make the ball do worse.'),
      step('3', 'The big run', 'Once a day the machine fires three balls: yours, plus two surprise balls with a twist (heavier, bouncier…). Guess how many make it!'),
    ),
    onDone,
    "Let's play",
  );
}
