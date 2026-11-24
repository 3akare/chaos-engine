/** Brute-force every arrangement of a machine's pieces: how many win 3 stars, and how many only the red ball. */
import { generateDay, historyOf, type DayHistory } from '../src/shared/generator/generate';
import { simulate } from '../src/shared/sim/engine';
import { parseLevel, type Level } from '../src/shared/sim/level';
import { PIECE_DIRS, W, type BoardPiece, type Machine, type PieceType } from '../src/shared/types';

export function analyse(m: Machine, cap = 400000): { total: number; red: number; three: number; ms: number } {
  const lv: Level = parseLevel(m);
  const sockets: number[] = [];
  for (let i = 0; i < lv.socket.length; i++) if (lv.socket[i]) sockets.push(i);
  const bag: PieceType[] = [];
  for (const [t, n] of Object.entries(m.inventory)) for (let k = 0; k < n; k++) bag.push(t as PieceType);
  let total = 0, red = 0, three = 0;
  const t0 = performance.now();
  const placed: BoardPiece[] = [];
  const used = new Set<number>();
  // Place bag[k] (or skip it) on any free socket in any direction; same-type pieces in increasing socket order.
  const rec = (k: number, minSock: number): void => {
    if (total >= cap) return;
    if (k === bag.length) {
      total++;
      const r = simulate(lv, placed);
      if (r.end !== 'success') return;
      red++;
      if (simulate(lv, placed, { variant: 'HEAVY' }).end === 'success' && simulate(lv, placed, { variant: 'BOUNCY' }).end === 'success') three++;
      return;
    }
    const same = k > 0 && bag[k] === bag[k - 1];
    rec(k + 1, 0); // leave this piece unused
    for (let si = same ? minSock : 0; si < sockets.length; si++) {
      const s = sockets[si]!;
      if (used.has(s)) continue;
      used.add(s);
      for (const d of PIECE_DIRS[bag[k]!]) {
        placed.push({ id: `p${k}`, type: bag[k]!, dir: d, x: s % W, y: Math.floor(s / W) });
        rec(k + 1, si + 1);
        placed.pop();
      }
      used.delete(s);
    }
  };
  rec(0, 0);
  return { total, red, three, ms: Math.round(performance.now() - t0) };
}

if (process.argv[1]?.endsWith('difficulty.ts')) {
  const hist: DayHistory[] = [];
  for (let d = 1; d <= Number(process.argv[2] ?? 14); d++) {
    const out = generateDay({ installSalt: 'diff', dayNumber: d, openMs: Date.UTC(2026, 11, 1, 2) + d * 864e5, history: hist.slice(0, 2) });
    hist.unshift(historyOf(out.machine));
    const m = out.machine;
    const a = analyse(m);
    const socks = m.rows.join('').split('o').length - 1;
    console.log(`day ${d} tier ${m.gen?.tier} pieces ${(m.solution ?? []).map((s) => s.type).join('+')} sockets ${socks}: arrangements ${a.total}, red wins ${a.red} (${((100 * a.red) / a.total).toFixed(2)}%), 3-star ${a.three} (${((100 * a.three) / a.total).toFixed(2)}%) in ${a.ms}ms`);
  }
}
