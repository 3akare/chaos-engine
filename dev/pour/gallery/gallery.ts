/** Dev gallery: ?seeds=1,2,3 draws generated machines; ?pack=1 draws the pack (with par builds). */
import { generateMachine } from '../../../src/shared/pour/generate';
import { artReady, drawStill } from '../../../src/client/pour/draw';
import type { Machine } from '../../../src/shared/pour/types';
import '../../../src/client/lib/font.css';

declare global {
  interface Window {
    __machines?: Machine[];
    __ready?: boolean;
  }
}
const qs = new URLSearchParams(location.search);
const g = document.getElementById('g')!;
void artReady().then(() => {
  const list: Machine[] = window.__machines ?? (qs.get('seeds') ?? '1001,1002,1003').split(',').map((s) => ({ ...generateMachine(Number(s)), name: `${s} ${generateMachine(Number(s)).name}` }));
  for (const m of list) {
    const cv = document.createElement('canvas');
    const f = document.createElement('figure');
    const cap = document.createElement('figcaption');
    cap.textContent = `${m.name} ${m.gen ? `best ${m.gen.best} rnd ${m.gen.random}` : ''} ${JSON.stringify(m.tools)}`;
    f.append(cv, cap);
    g.append(f);
    drawStill(cv, m, qs.get('par') ? (m.gen?.par ?? []) : []);
  }
  window.__ready = true;
});
