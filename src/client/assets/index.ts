/** Every sprite, as a URL keyed by file name (Kenney CC0 art; see LICENSE.md). */
const files = import.meta.glob('./*.png', { eager: true, import: 'default' }) as Record<string, string>;
const iconFiles = import.meta.glob('./icons/*.png', { eager: true, import: 'default' }) as Record<string, string>;

const byName = (m: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [k.replace(/^.*\//, '').replace(/\.png$/, ''), v]));

export const SPRITES = byName(files);
export const ICONS = byName(iconFiles);
export const sprite = (name: string): string => SPRITES[name] ?? '';
export const icon = (name: string): string => ICONS[name] ?? '';

import type { Dir, PieceType } from '../../shared/types';

/** Which sprite shows a piece, and how it is turned/flipped for a direction. */
export function pieceLook(type: PieceType, dir: Dir): { key: string; angle: number; flip: boolean } {
  switch (type) {
    case 'RAMP':
      return { key: 'ramp', angle: 0, flip: dir === 'DL' };
    case 'SPRING':
      return { key: 'spring_out', angle: dir === 'UR' ? 45 : dir === 'UL' ? -45 : 0, flip: false };
    case 'FAN':
      return { key: 'booster', angle: dir === 'L' ? 180 : dir === 'U' ? -90 : 0, flip: false };
    case 'BUMPER':
      return { key: 'bumper_out', angle: dir === 'L' ? -90 : 90, flip: false };
  }
}
