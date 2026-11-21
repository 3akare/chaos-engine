/** Usage: npx tsx dev/tools/check-machine.ts <fixtureName|path.json> — prints runs + §5.3 report. */
import { readFileSync } from 'node:fs';
import { parseLevel, simulate, renderAscii, solutionPieces, VARIANTS } from '../../src/shared/sim';
import { validateMachine } from '../../src/shared/generator/validate';
import { FIXTURES } from '../../src/shared/fixtures';
import type { Machine } from '../../src/shared/types';

const arg = process.argv[2] ?? '';
const machines: Machine[] = arg.endsWith('.json') ? [JSON.parse(readFileSync(arg, 'utf8')) as Machine] : FIXTURES.filter((f) => !arg || f.name === arg);
for (const m of machines) {
  const level = parseLevel(m);
  const sol = solutionPieces(m);
  console.log(`=== ${m.name} (tier ${m.gen?.tier})`);
  const e = simulate(level, []);
  const s = simulate(level, sol);
  const a = renderAscii(level, [], e).split('\n');
  const b = renderAscii(level, sol, s).split('\n');
  console.log(a.map((l, i) => l.padEnd(28) + (b[i] ?? '')).join('\n'));
  for (const v of VARIANTS) {
    const r = simulate(level, sol, { variant: v.id });
    console.log(`  ${v.id.padEnd(9)} ${r.end} ${r.ticks}`);
  }
  console.log(validateMachine(m, { tier: m.gen?.tier ?? 1 }));
}
