import { parseLevel, simulate, renderAscii } from '../../src/shared/sim';
import type { BoardPiece } from '../../src/shared/types';
const rows = process.argv[2]!.split('/');
const pieces: BoardPiece[] = JSON.parse(process.argv[3] ?? '[]');
const lvl = parseLevel({ rows, start: { dx: Number(process.argv[4] ?? 1) as 1 }, links: [], objective: { type: 'DELIVER' } });
for (const v of (process.argv[5] ?? 'STANDARD').split(',')) {
  const r = simulate(lvl, pieces, { variant: v as 'STANDARD' });
  console.log(v); console.log(renderAscii(lvl, pieces, r));
  console.log(r.frames.map(f=>`${f.x},${f.y}${f.mode[0]}`).join(' '));
}
