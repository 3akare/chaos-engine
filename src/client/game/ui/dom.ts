/** Minimal DOM helpers: element builder, bottom sheet, modal, toast. */
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

let scrim: HTMLElement | null = null;
let openSheet: HTMLElement | null = null;
let openModal: HTMLElement | null = null;
let onCloseSheet: (() => void) | null = null;

function ensureScrim(close: () => void): HTMLElement {
  if (!scrim) {
    scrim = h('div', { class: 'scrim' });
    document.body.append(scrim);
  }
  scrim.onclick = close;
  requestAnimationFrame(() => scrim!.classList.add('show'));
  return scrim;
}
function hideScrim(): void {
  if (!scrim || openSheet || openModal) return;
  scrim.classList.remove('show');
  const s = scrim;
  scrim = null;
  setTimeout(() => s.remove(), 200);
}

/** Show a bottom sheet. `modal: false` keeps the board tappable (used by the palette). */
export function showSheet(content: HTMLElement, opts: { onClose?: () => void; modal?: boolean } = {}): HTMLElement {
  closeSheet(true);
  const el = h('div', { class: 'sheet', role: 'dialog' }, h('div', { class: 'grabber' }), content);
  document.body.append(el);
  openSheet = el;
  onCloseSheet = opts.onClose ?? null;
  if (opts.modal !== false) ensureScrim(() => closeSheet());
  requestAnimationFrame(() => el.classList.add('show'));
  return el;
}

export function closeSheet(silent = false): void {
  if (!openSheet) return;
  const el = openSheet;
  openSheet = null;
  el.classList.remove('show');
  setTimeout(() => el.remove(), 230);
  const cb = onCloseSheet;
  onCloseSheet = null;
  if (!silent) cb?.();
  hideScrim();
}

export const sheetOpen = (): boolean => openSheet !== null;

export function showModal(content: HTMLElement, onClose?: () => void, closeLabel = 'Got it'): void {
  closeModal();
  const close = (): void => {
    closeModal();
    onClose?.();
  };
  const el = h('div', { class: 'modal', role: 'dialog' }, content, h('button', { class: 'btn primary close', onclick: close }, closeLabel));
  document.body.append(el);
  openModal = el;
  ensureScrim(close);
  requestAnimationFrame(() => el.classList.add('show'));
}

export function closeModal(): void {
  if (!openModal) return;
  const el = openModal;
  openModal = null;
  el.classList.remove('show');
  setTimeout(() => el.remove(), 200);
  hideScrim();
}

let toastTimer = 0;
export function toast(text: string, ms = 2600): void {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const el = h('div', { class: 'toast', role: 'status' }, text);
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.remove(), ms);
}

export function fmtCountdown(ms: number): string {
  if (ms <= 0) return 'locking…';
  const s = Math.floor(ms / 1000);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  if (hh > 0) return `${hh}h ${String(mm).padStart(2, '0')}m`;
  const ss = s % 60;
  return `${mm}m ${String(ss).padStart(2, '0')}s`;
}

export function ago(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const hrs = Math.round(m / 60);
  return `${hrs} h ago`;
}
