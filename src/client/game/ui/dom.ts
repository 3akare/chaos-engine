/** Tiny UI kit: element builder, sprite/icon images, one card at a time, one status line. */
import type { Dir, PieceType } from '../../../shared/types';
import { icon, pieceLook, sprite } from '../../assets';

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | boolean | ((e: Event) => void)> = {}, ...kids: Array<Node | string | null | undefined | false>): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v as EventListener);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false) el.setAttribute(k, v);
  }
  for (const k of kids) if (k !== null && k !== undefined && k !== false) el.append(k);
  return el;
}

/** A white game icon (Kenney Game Icons). */
export const ico = (name: string): HTMLImageElement => h('img', { src: icon(name), alt: '' });
/** A board sprite. */
export const spr = (name: string, cls = ''): HTMLImageElement => h('img', { src: sprite(name), alt: '', class: cls });
/** A piece as it looks on the board, turned to its direction. */
export function pieceImg(type: PieceType, dir: Dir): HTMLImageElement {
  const l = pieceLook(type, dir);
  const i = spr(l.key);
  i.style.transform = `rotate(${l.angle}deg)${l.flip ? ' scaleX(-1)' : ''}`;
  return i;
}

let openVeil: HTMLElement | null = null;

/** A card in the middle of the screen with one button. Tapping outside closes it too (onClose runs either way, onCta only for the button). */
export function showCard(content: HTMLElement, cta: string | null, onClose?: () => void, onCta?: () => void): () => void {
  closeCard();
  const veil = h('div', { class: 'veil', role: 'dialog' });
  const close = (): void => {
    if (openVeil !== veil) return;
    openVeil = null;
    veil.classList.remove('show');
    setTimeout(() => veil.remove(), 200);
    onClose?.();
  };
  const card = h('div', { class: 'card' }, ...(content.childNodes.length ? [...content.childNodes] : [content]));
  if (cta)
    card.append(
      h(
        'button',
        {
          class: 'key cta hud',
          onclick: () => {
            close();
            onCta?.();
          },
        },
        cta,
      ),
    );
  card.addEventListener('click', (e) => e.stopPropagation());
  veil.addEventListener('click', close);
  veil.append(card);
  document.body.append(veil);
  openVeil = veil;
  requestAnimationFrame(() => veil.classList.add('show'));
  return close;
}

export function closeCard(): void {
  if (!openVeil) return;
  const v = openVeil;
  openVeil = null;
  v.classList.remove('show');
  setTimeout(() => v.remove(), 200);
}

export const cardOpen = (): boolean => openVeil !== null;

let tagEl: HTMLElement | null = null;
let tagTimer = 0;
/** One short line just above the dock. `sticky` keeps it until replaced or cleared. */
export function tag(text: string, kind: 'good' | 'bad' | 'same' = 'same', sticky = false): void {
  if (!tagEl || !tagEl.isConnected) {
    tagEl = h('div', { class: 'tag', role: 'status', 'aria-live': 'polite' });
    (document.getElementById('board') ?? document.body).append(tagEl);
  }
  tagEl.className = `tag ${kind}`;
  tagEl.replaceChildren(h('i', {}), text);
  requestAnimationFrame(() => tagEl?.classList.add('show'));
  clearTimeout(tagTimer);
  if (!sticky) tagTimer = window.setTimeout(clearTag, 2600);
}

export function clearTag(): void {
  clearTimeout(tagTimer);
  tagEl?.classList.remove('show');
}

export const toast = (text: string): void => tag(text, 'bad');

export function fmtCountdown(ms: number): string {
  if (ms <= 0) return '';
  const s = Math.floor(ms / 1000);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  if (hh > 0) return `${hh}h ${String(mm).padStart(2, '0')}m`;
  return `${mm}m ${String(s % 60).padStart(2, '0')}s`;
}
