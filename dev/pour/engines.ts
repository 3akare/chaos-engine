/**
 * Same pours, every ball position hashed every step. Run under Node (V8) and Bun (JavaScriptCore,
 * the engine in Safari and every iPhone browser); the outputs must match exactly:
 *   npx tsx dev/pour/engines.ts; bun dev/pour/engines.ts
 */
import { generateMachine } from '../../src/shared/pour/generate';
import { randomBuild } from '../../src/shared/pour/search';
import { Pour } from '../../src/shared/pour/sim';
import { Rng } from '../../src/shared/rng';
const out: string[] = [];
for (const seed of [11, 12, 13, 14, 15, 16]) {
  const m = generateMachine(seed); const rng = new Rng(seed);
  for (let i = 0; i < 3; i++) {
    const p = new Pour(m, randomBuild(m, rng));
    let h = 0;
    while (!p.done) { p.step(); p.events.length = 0; for (const b of p.balls) h = (h * 31 + Math.round(b.position.x * 1e6) + Math.round(b.position.y * 1e6)) % 2147483647; }
    out.push(`${p.caught}:${p.t}:${h}`);
  }
}
console.log(out.join(' '));
