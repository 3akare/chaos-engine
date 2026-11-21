import { Rng } from '../../src/shared/rng';
import { Grid, fixToPiece } from '../../src/shared/generator/grid';
import { BUILDERS, type Family } from '../../src/shared/generator/bands';
import { simulate, renderAscii } from '../../src/shared/sim';
const fam = (process.argv[2] ?? 'drop') as Family;
const h = Number(process.argv[3] ?? 4);
const edx = Number(process.argv[4] ?? 1);
let ok = 0, nulls = 0, noexit = 0, notbroken = 0;
for (let s = 0; s < 200; s++) {
  const rng = new Rng(s);
  const g = new Grid(); const sx = 4; g.set(sx, 0, 'S');
  const plan = BUILDERS[fam]({ g, rng, y0: 0, h, ex: sx, edx, reserved: new Set([sx]), start: { x: sx, y: 0 } });
  if (!plan) { nulls++; continue; }
  const lvl = g.level(edx as 1);
  const solved = simulate(lvl, plan.fixes.map(fixToPiece), { stopAtRow: h, maxTicks: 60 });
  const broken = simulate(lvl, [], { stopAtRow: h, maxTicks: 60 });
  if (!solved.exit) { noexit++; if (noexit <= 2) console.log(renderAscii(lvl, plan.fixes.map(fixToPiece), solved)); continue; }
  if (fam !== 'funnel' && broken.exit) { notbroken++; if (notbroken<=2) console.log('NOT BROKEN\n'+renderAscii(lvl, [], broken)); continue; }
  ok++;
}
console.log(JSON.stringify({ fam, h, edx, ok, nulls, noexit, notbroken }));
