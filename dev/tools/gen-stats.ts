/** Usage: npx tsx dev/tools/gen-stats.ts [days=100] [show=0] — runs the generator gate locally. */
import { generateDay, historyOf, type DayHistory } from '../../src/shared/generator/generate';
import { levelOf, renderAscii, simulate, solutionPieces } from '../../src/shared/sim';

const days = Number(process.argv[2] ?? 100);
const show = Number(process.argv[3] ?? 0);
const DAY = 86_400_000;
const t0 = Date.UTC(2026, 11, 1, 12);
const hist: DayHistory[] = [];
const attempts: number[] = [];
const rej: Record<string, number> = {};
let fallbacks = 0;
let maxMs = 0;
for (let n = 1; n <= days; n++) {
  const s = performance.now();
  const out = generateDay({ installSalt: 'salt', dayNumber: n, openMs: t0 + n * DAY, history: hist.slice(0, 2) });
  const ms = performance.now() - s;
  maxMs = Math.max(maxMs, ms);
  attempts.push(out.attemptsTried);
  if (out.fallback) fallbacks++;
  for (const [k, v] of Object.entries(out.rejections)) rej[k] = (rej[k] ?? 0) + v;
  hist.unshift(historyOf(out.machine));
  if (n <= show) {
    const m = out.machine;
    const l = levelOf(m);
    const a = renderAscii(l, [], simulate(l, [])).split('\n');
    const b = renderAscii(l, solutionPieces(m), simulate(l, solutionPieces(m))).split('\n');
    console.log(`--- Day ${n}: ${m.name} tier ${m.gen?.tier} [${m.gen?.families.join(' > ')}] attempt ${out.attempt} (${out.attemptsTried} tried, ${Math.round(ms)} ms)`);
    console.log(a.map((x, i) => x.padEnd(28) + (b[i] ?? '')).join('\n'));
  }
}
attempts.sort((a, b) => a - b);
console.log(`days=${days} fallbacks=${fallbacks} medianAttempts=${attempts[attempts.length >> 1]} p90=${attempts[Math.floor(attempts.length * 0.9)]} max=${attempts.at(-1)} maxMs=${Math.round(maxMs)}`);
console.log('rejections', Object.entries(rej).sort((a, b) => b[1] - a[1]));
