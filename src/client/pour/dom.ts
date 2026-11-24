/** Tiny element builder. */
import { icon, sprite } from '../assets';

type Attr = string | boolean | ((e: Event) => void);
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, Attr> = {}, ...kids: Array<Node | string | null | undefined | false>): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v as EventListener);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false) el.setAttribute(k, v);
  }
  for (const k of kids) if (k !== null && k !== undefined && k !== false) el.append(k);
  return el;
}
export const ico = (name: string, cls = ''): HTMLImageElement => h('img', { src: icon(name), alt: '', class: cls });
export const spr = (name: string, cls = ''): HTMLImageElement => h('img', { src: sprite(name), alt: '', class: cls });
export const fmt = (n: number): string => n.toLocaleString('en-US');

export function store(key: string, value?: string): string | null {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
  return null;
}

/** "5h 12m" / "12m" until a time. */
export function until(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}
