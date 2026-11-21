/** Content modals: how to play, the sealed hash, the personal report, piece cards. */
import type { DayView, InboxItem, StoredPiece } from '../../../shared/protocol';
import { VARIANTS } from '../../../shared/sim/variants';
import { sha256Hex } from '../../../shared/sha256';
import { ago, h, showModal } from './dom';
import { DIR_LABEL, PIECE_LABEL, pieceIcon } from './icons';

export function howToPlay(): void {
  showModal(
    h(
      'div',
      {},
      h('h2', {}, 'How to play'),
      h('p', {}, 'Every day the subreddit shares ', h('b', {}, 'one broken machine'), '. Fix it together, one piece each.'),
      h(
        'table',
        {},
        ...[
          ['▶ Test run', 'Run Ball 1 as often as you like. It is free and instant.'],
          ['➕ Place', 'Hold one piece at a time: ramp, spring, fan or bumper, in a dashed socket.'],
          ['🛡 Protected', 'A piece can never make Ball 1 do worse. Replacing someone else’s piece needs a strictly better result.'],
          ['🎲 Lock', 'At lock, three balls fire: Ball 1, plus two secret variants.'],
          ['🔮 Predict', 'Guess how many of the 3 balls will make it. Keep your streak.'],
        ].map(([a, b]) => h('tr', {}, h('td', {}, h('b', {}, a!)), h('td', {}, b!))),
      ),
      h('p', {}, h('b', {}, 'Only Ball 1’s progress is protected, not whether the machine will win.'), ' The secret balls can be helped — or hurt — by any piece.'),
      h('h2', { style: 'margin-top:14px;font-size:17px' }, 'The six secret variants'),
      h('table', {}, ...VARIANTS.map((v) => h('tr', {}, h('td', {}, h('b', {}, v.name)), h('td', {}, v.effect)))),
      h('p', { style: 'color:var(--muted);font-size:13px' }, 'Coordinates like C7 are on the board edges — use them in the comments.'),
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
  const lines: Array<string | HTMLElement> = [`${PIECE_LABEL[p.type]} facing ${DIR_LABEL[p.dir]} · placed ${ago(view.serverNow - p.placedAt)}`];
  if (p.editedAt) lines.push(`edited ${ago(view.serverNow - p.editedAt)}`);
  if (p.replaced) lines.push(`replaced u/${p.replaced.username}'s ${PIECE_LABEL[p.replaced.type].toLowerCase()}`);
  return h(
    'div',
    {},
    h('div', { style: 'display:flex;gap:10px;align-items:center' }, pieceIcon(p.type, p.dir, 40), h('div', {}, h('h3', {}, `${who} · ${p.socket}`), h('div', { class: 'sub', style: 'margin:0' }, lines.join(' · ')))),
    h('div', { class: 'row', style: 'margin-top:10px' }, ...actions.map((a) => h('button', { class: `btn${a.primary ? ' primary' : ''}`, onclick: a.run }, a.label))),
  );
}
