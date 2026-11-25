/**
 * Look for a build that catches all 100 balls on each daily machine, starting from the
 * generator's best build and climbing further, with restarts when it gets stuck. A closed day
 * shows its machine's stored build as "the solution", so the better it is, the better.
 *   npx tsx dev/pour/perfect.ts <minutes per machine> <out.jsonl> [machine index ...]
 *   npx tsx dev/pour/perfect.ts merge <out.jsonl>
 * The first appends { index, name, best, build } per machine as it finishes. "merge" pours each
 * found build again and, where it beats the stored one, writes it into src/shared/pour/pack.json.
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PACK } from '../../src/shared/pour/pack';
import { Rng } from '../../src/shared/rng';
import { climb } from '../../src/shared/pour/search';
import { runPour } from '../../src/shared/pour/sim';
import type { Machine, Piece } from '../../src/shared/pour/types';

const [, , role, a, b, ...rest] = process.argv;

if (role === 'merge') {
  const rows = readFileSync(a ?? 'dev/pour/perfect.jsonl', 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { index: number; name: string; best: number; build: Piece[] });
  const pack = JSON.parse(readFileSync('src/shared/pour/pack.json', 'utf8')) as Machine[];
  for (const r of rows) {
    const m = pack[r.index];
    if (!m || m.name !== r.name || !m.gen) continue;
    const score = runPour(m, r.build);
    if (score !== r.best) {
      process.stdout.write(`${r.name}: found ${r.best} but pours ${score} now; skipped\n`);
      continue;
    }
    if (score > m.gen.best) {
      process.stdout.write(`${r.name}: ${m.gen.best} → ${score}\n`);
      m.gen = { ...m.gen, best: score, par: r.build };
    } else process.stdout.write(`${r.name}: stays at ${m.gen.best}\n`);
  }
  writeFileSync('src/shared/pour/pack.json', JSON.stringify(pack) + '\n');
} else if (role === 'worker') {
  const index = Number(a);
  const minutes = Number(b);
  const out = rest[0]!;
  const m = PACK[index]!;
  const deadline = Date.now() + minutes * 60_000;
  let bestBuild: Piece[] = m.gen?.par ?? [];
  let best = runPour(m, bestBuild);
  let round = 0;
  while (best < 100 && Date.now() < deadline) {
    round += 1;
    // Climb from the best so far with a fresh random stream: an iterated local search.
    const r = climb(m, new Rng(index * 1_000_003 + round * 7919), bestBuild, 120);
    if (r.best > best) {
      best = r.best;
      bestBuild = r.build;
      process.stdout.write(`${m.name}: ${best} after round ${round}\n`);
    }
  }
  appendFileSync(out, JSON.stringify({ index, name: m.name, best, build: bestBuild }) + '\n');
  process.stdout.write(`${m.name}: done at ${best}\n`);
} else {
  const minutes = Number(role ?? 20);
  const out = a ?? 'dev/pour/perfect.jsonl';
  const which = (b !== undefined ? [b, ...rest] : PACK.map((_, i) => String(i))).map(Number);
  const self = fileURLToPath(import.meta.url);
  // One worker per machine, four at a time.
  const queue = [...which];
  const launch = () => {
    const i = queue.shift();
    if (i === undefined) return;
    const child = fork(self, ['worker', String(i), String(minutes), out], { execArgv: ['--import', 'tsx'] });
    child.on('exit', launch);
  };
  for (let k = 0; k < 4; k++) launch();
}
