/** Search for a 2-piece combo on a fixture grid that delivers while each single piece lowers P. */
import { FIXTURES } from '../../src/shared/fixtures';
import { levelOf, simulate, compareProgress } from '../../src/shared/sim';
import { PIECE_DIRS, PIECE_TYPES, W, H, type BoardPiece } from '../../src/shared/types';
for (const m of FIXTURES) {
  const l = levelOf(m);
  const P0 = simulate(l, []).progress;
  const singles: BoardPiece[] = [];
  for (let i = 0; i < W * H; i++) if (l.socket[i]) for (const t of PIECE_TYPES) for (const d of PIECE_DIRS[t]) singles.push({ id: `${i}${t}${d}`, type: t, dir: d, x: i % W, y: Math.floor(i / W) });
  const worse = singles.filter((p) => compareProgress(simulate(l, [p]).progress, P0) < 0);
  for (let a = 0; a < worse.length; a++) for (let b = a + 1; b < worse.length; b++) {
    const A = worse[a]!, B = worse[b]!;
    if (A.x === B.x && A.y === B.y) continue;
    if (simulate(l, [A, B]).end === 'success') { console.log(m.name, JSON.stringify([A, B])); process.exit(0); }
  }
}
console.log('none');
