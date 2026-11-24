/** Every sprite, as a URL keyed by file name (Kenney CC0 art; see LICENSE.md). */
const files = import.meta.glob('./*.png', { eager: true, import: 'default' }) as Record<string, string>;
const iconFiles = import.meta.glob('./icons/*.png', { eager: true, import: 'default' }) as Record<string, string>;

const byName = (m: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [k.replace(/^.*\//, '').replace(/\.png$/, ''), v]));

export const SPRITES = byName(files);
export const ICONS = byName(iconFiles);
export const sprite = (name: string): string => SPRITES[name] ?? '';
export const icon = (name: string): string => ICONS[name] ?? '';
