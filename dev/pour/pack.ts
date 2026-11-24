/**
 * Build the pack of daily machines: generate candidates, pour each hundreds of times, keep the
 * ones that random builds fail (median ≤ 25, empty ≤ 15) but a climbed build nearly clears (≥ 88).
 *   npx tsx dev/pour/pack.ts <workers> <out.jsonl> [first seed]
 * Each worker appends accepted machines to the JSONL as it goes.
 */
import { appendFileSync } from 'node:fs';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GEN_VERSION, generateMachine } from '../../src/shared/pour/generate';
import { Rng } from '../../src/shared/rng';
import { climb, median, vet } from '../../src/shared/pour/search';

const [, , role, a, b, c, d] = process.argv;

if (role === 'worker') {
  const k = Number(a);
  const stride = Number(b);
  const out = c!;
  for (let seed = Number(d ?? 1000) + k; ; seed += stride) {
    const m = generateMachine(seed);
    const t = Date.now();
    const v = vet(m, seed, 10, 260, (p) => (p.empty ?? 0) > 15 || (p.random ? median(p.random) > 20 : false));
    const tag = `seed ${seed} ${m.name}`;
    if (!v) {
      process.stdout.write(`${tag}: rejected early (${((Date.now() - t) / 1000).toFixed(0)}s)\n`);
      continue;
    }
    // Promising but not there yet: keep climbing from where the search got to.
    if (v.climb.best >= 60 && v.climb.best < 85) {
      const more = climb(m, new Rng(seed * 7), v.climb.build, 300);
      if (more.best > v.climb.best) v.climb = { ...more, evals: more.evals + v.climb.evals };
    }
    const ok = v.climb.best >= 72;
    process.stdout.write(`${tag}: empty ${v.empty} random ${median(v.random)} climb ${v.climb.best} (${v.climb.evals} pours, ${((Date.now() - t) / 1000).toFixed(0)}s) ${ok ? 'KEEP' : ''}\n`);
    if (ok) {
      m.gen = { version: GEN_VERSION, best: v.climb.best, random: median(v.random), par: v.climb.build };
      appendFileSync(out, JSON.stringify({ genSeed: seed, ...m }) + '\n');
    }
  }
} else {
  const workers = Number(role ?? 4);
  const out = a ?? 'dev/pour/pack.jsonl';
  const from = b ?? '1000';
  const self = fileURLToPath(import.meta.url);
  for (let k = 0; k < workers; k++) fork(self, ['worker', String(k), String(workers), out, from], { execArgv: ['--import', 'tsx'] });
}
