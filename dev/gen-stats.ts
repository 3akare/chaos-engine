/** Quick report: which pieces each generated day's solution needs, and what stock players get. */
import { generateDay, historyOf, type DayHistory } from '../src/shared/generator/generate';

const N = Number(process.argv[2] ?? 60);
const history: DayHistory[] = [];
const kinds: Record<string, number> = {};
let fallbacks = 0;
let oneType = 0;
const t0 = Date.UTC(2026, 11, 1, 2);
for (let d = 1; d <= N; d++) {
  const out = generateDay({ installSalt: 'stats', dayNumber: d, openMs: t0 + d * 86400000, history: history.slice(0, 7) });
  history.unshift(historyOf(out.machine));
  if (out.fallback) fallbacks++;
  const sol = (out.machine.solution ?? []).map((s) => s.type);
  const key = [...sol].sort().join('+');
  kinds[key] = (kinds[key] ?? 0) + 1;
  if (new Set(sol).size <= 1) oneType++;
  if (d <= 8) console.log(`day ${d} tier ${out.machine.gen?.tier} solution ${sol.join(',')} stock ${JSON.stringify(out.machine.inventory)} attempts ${out.attemptsTried}`);
}
console.log('solutions:', kinds);
console.log(`single-type days: ${oneType}/${N}, fallbacks: ${fallbacks}`);
