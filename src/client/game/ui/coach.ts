/** First-open coach (§7.2): three steps, under ten seconds, tap anywhere to advance. */
import { h } from './dom';

const KEY = 'ce_coach_v1';

export function coachSeen(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* private mode */
  }
}

export type CoachStep = { text: string; target: () => DOMRect | null; below?: boolean };

export function runCoach(steps: CoachStep[], onDone: () => void): void {
  let i = 0;
  const ring = h('div', { class: 'ring' });
  const bubble = h('div', { class: 'bubble' });
  const root = h('div', { class: 'coach', role: 'dialog', 'aria-live': 'polite' }, ring, bubble);
  let timer = 0;
  const finish = (): void => {
    clearTimeout(timer);
    root.remove();
    markSeen();
    onDone();
  };
  const show = (): void => {
    const s = steps[i];
    if (!s) return finish();
    const r = s.target();
    if (r) {
      ring.style.display = 'block';
      ring.style.left = `${r.left - 6}px`;
      ring.style.top = `${r.top - 6}px`;
      ring.style.width = `${r.width + 12}px`;
      ring.style.height = `${r.height + 12}px`;
      bubble.style.top = s.below ? `${Math.min(window.innerHeight - 120, r.bottom + 16)}px` : `${Math.max(12, r.top - 96)}px`;
    } else {
      ring.style.display = 'none';
      bubble.style.top = '40%';
    }
    bubble.replaceChildren(s.text, h('small', {}, `${i + 1} / ${steps.length} · tap to continue`));
    clearTimeout(timer);
    timer = window.setTimeout(next, 3200);
  };
  const next = (): void => {
    i++;
    show();
  };
  root.addEventListener('click', next);
  document.body.append(root);
  show();
}
