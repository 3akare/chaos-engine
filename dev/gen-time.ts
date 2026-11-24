import { generateDay, historyOf, type DayHistory } from '../src/shared/generator/generate';
const hist: DayHistory[] = [];
const times: number[] = [];
let fb = 0;
const N = Number(process.argv[2] ?? 20);
const why: Record<string, number> = {};
for (let d = 1; d <= N; d++) {
  const t = performance.now();
  const out = generateDay({ installSalt: process.argv[3] ?? 'time', dayNumber: d, openMs: Date.UTC(2026, 11, 1, 2) + d * 864e5, history: hist.slice(0, 2) });
  times.push(performance.now() - t);
  hist.unshift(historyOf(out.machine));
  if (out.fallback) fb++;
  for (const [k, v] of Object.entries(out.rejections)) if (k.startsWith('validate')) why[k] = (why[k] ?? 0) + v;
}
times.sort((a, b) => a - b);
console.log(`median ${Math.round(times[N >> 1]!)}ms max ${Math.round(times[N - 1]!)}ms fallbacks ${fb}/${N}`, why);
