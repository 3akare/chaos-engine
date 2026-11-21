/** Deterministic integer hashing and RNG. No floats in game state. */

/** 32-bit FNV-1a over a string, finished with a murmur3 avalanche. */
export function hash32(...parts: Array<string | number>): number {
  let h = 0x811c9dc5;
  const s = parts.join('␟');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** mulberry32: returns a function producing uint32 values. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/** Integer-only convenience wrapper around mulberry32. */
export class Rng {
  private next: () => number;
  constructor(seed: number) {
    this.next = mulberry32(seed);
  }
  u32(): number {
    return this.next();
  }
  /** Integer in [0, n). */
  int(n: number): number {
    return n <= 0 ? 0 : this.next() % n;
  }
  /** Integer in [lo, hi] inclusive. */
  range(lo: number, hi: number): number {
    return lo + this.int(hi - lo + 1);
  }
  /** True with probability num/den. */
  chance(num: number, den: number): boolean {
    return this.int(den) < num;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)]!;
  }
  shuffle<T>(arr: readonly T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  }
}

/** Seed for a Day's secret variants (§2.6, §4.9). */
export const daySeed = (dayId: string, secret: string): number => hash32(dayId, secret);
