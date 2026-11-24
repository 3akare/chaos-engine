/** Content modals: how to play, the sealed hash, the personal report, piece cards. */
import type { DayView, InboxItem, StoredPiece } from '../../../shared/protocol';
import { VARIANTS } from '../../../shared/sim/variants';
import { sha256Hex } from '../../../shared/sha256';
import { ago, h, showModal } from './dom';
import { PIECE_LABEL, pieceIcon } from './icons';

export function howToPlay(): void {
  showModal(
    h(
      'div',
      {},
      h('h2', {}, 'How to play'),
      h('p', {}, 'Get the ball from the chute at the top into the goal at the bottom.'),
      h(
        'table',
        {},
        ...[
          ['▶ Test run', 'See where the ball goes right now. Free, as often as you like.'],
          ['➕ Place', 'Tap a dashed square and pick a piece. Tap the piece again to turn it.'],
          ['🛡 No griefing', 'A piece can never make the ball do worse. To swap someone else’s piece, yours has to work better.'],
          ['🧩 Pieces', 'On your own you can place every piece the fix needs. When more people join, you share them.'],
          ['💥 The big run', 'Once a day the machine fires 3 balls. Your score is how many reach the goal.'],
          ['🔮 Guess', 'Predict how many will make it.'],
        ].map(([a, b]) => h('tr', {}, h('td', {}, h('b', {}, a!)), h('td', {}, b!))),
      ),
      h('h2', { style: 'margin-top:14px;font-size:17px' }, 'The surprise balls'),
      h('p', { class: 'muted', style: 'margin-top:0' }, 'Two of these are picked each day, and you only find out which when the machine fires. A machine that only works for your ball might not work for them.'),
      h('table', {}, ...VARIANTS.map((v) => h('tr', {}, h('td', {}, h('b', {}, v.name)), h('td', {}, v.effect)))),
      h('p', { class: 'muted', style: 'font-size:13px' }, 'The surprise balls are locked in when the day starts, so nobody can change them later.'),
    ),
  );
}

export function sealInfo(view: DayView): void {
  const revealed = view.result?.revealedSecret;
  const ok = revealed ? sha256Hex(revealed) === view.day.commitHash : null;
  showModal(
    h(
      'div',
      {},
      h('h2', {}, revealed ? '🔓 The seal is open' : '🔒 Today’s secret balls are sealed'),
      h('p', {}, 'When this machine opened, the two secret balls were drawn from a random secret seed. Only its fingerprint (SHA-256) was published:'),
      h('div', { class: 'hash' }, view.day.commitHash),
      revealed
        ? h('div', {}, h('p', {}, 'After the lock the seed was revealed:'), h('div', { class: 'hash' }, revealed), h('p', {}, ok ? '✅ sha256(seed) matches the published fingerprint — nobody could change the secret balls after seeing your pieces.' : '⚠️ The fingerprint does not match.'))
        : h('p', {}, 'At the lock the seed is revealed, so anyone can check that the secret balls were fixed before a single piece was placed.'),
    ),
  );
}

export function reportModal(items: InboxItem[], onDone: () => void): void {
  showModal(
    h('div', {}, h('h2', {}, 'While you were away…'), ...items.map((i) => h('div', { class: 'card' }, h('div', { class: 'k' }, `Day ${i.dayNumber}`), i.text))),
    onDone,
    'Nice',
  );
}

export function pieceCard(p: StoredPiece, view: DayView, actions: Array<{ label: string; primary?: boolean; run: () => void }>): HTMLElement {
  const mine = p.userId === view.me.userId && !p.setup;
  const who = p.setup ? `u/${p.username} (setup)` : mine ? 'Your piece' : `u/${p.username}`;
  const lines: Array<string | HTMLElement> = [`${PIECE_LABEL[p.type]}, placed ${ago(view.serverNow - p.placedAt)}`];
  if (p.editedAt) lines.push(`edited ${ago(view.serverNow - p.editedAt)}`);
  if (p.replaced) lines.push(`swapped in for u/${p.replaced.username}'s ${PIECE_LABEL[p.replaced.type].toLowerCase()}`);
  return h(
    'div',
    {},
    h('div', { style: 'display:flex;gap:10px;align-items:center' }, pieceIcon(p.type, p.dir, 40), h('div', {}, h('h3', {}, who), h('div', { class: 'sub', style: 'margin:0' }, lines.join(' · ')))),
    h('div', { class: 'row', style: 'margin-top:10px' }, ...actions.map((a) => h('button', { class: `btn${a.primary ? ' primary' : ''}`, onclick: a.run }, a.label))),
  );
}
