/**
 * Deterministic sin / cos / atan2 built from + - * / and Math.round only, so every phone and the
 * server compute bit-identical physics. Native Math.sin differs in the last bit between engines
 * (V8 vs JavaScriptCore), and 100 bouncing balls turn one bit into a different score.
 * Polynomials are fdlibm's kernels; the reduction is a two-part Cody-Waite step (plenty for the
 * angles the sim produces).
 */
const INV_PIO2 = 6.36619772367581382433e-1;
const PIO2_1 = 1.57079632673412561417e0;
const PIO2_1T = 6.07710050650619224932e-11;

function ksin(x: number): number {
  const z = x * x;
  const v = z * x;
  const r = 8.33333333332248946124e-3 + z * (-1.98412698298579493134e-4 + z * (2.75573137070700676789e-6 + z * (-2.50507602534068634195e-8 + z * 1.58969099521155010221e-10)));
  return x + v * (-1.66666666666666324348e-1 + z * r);
}

function kcos(x: number): number {
  const z = x * x;
  const r = z * (4.16666666666666019037e-2 + z * (-1.38888888888741095749e-3 + z * (2.48015872894767294178e-5 + z * (-2.75573143513906633035e-7 + z * (2.08757232129817482790e-9 + z * -1.13596475577881948265e-11)))));
  const hz = 0.5 * z;
  const w = 1 - hz;
  return w + (1 - w - hz + z * r);
}

function reduce(x: number): [number, number] {
  const n = Math.round(x * INV_PIO2);
  const y = x - n * PIO2_1 - n * PIO2_1T;
  return [y, ((n % 4) + 4) % 4];
}

export function dsin(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  const [y, q] = reduce(x);
  return q === 0 ? ksin(y) : q === 1 ? kcos(y) : q === 2 ? -ksin(y) : -kcos(y);
}

export function dcos(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  const [y, q] = reduce(x);
  return q === 0 ? kcos(y) : q === 1 ? -ksin(y) : q === 2 ? -kcos(y) : ksin(y);
}

/** atan on [0, inf) via fdlibm's breakpoints and polynomial. */
const ATAN_HI = [4.63647609000806093515e-1, 7.85398163397448278999e-1, 9.82793723247329054082e-1, 1.57079632679489655800e0];
const ATAN_LO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT = [3.33333333333329318027e-1, -1.99999999998764832476e-1, 1.42857142725034663711e-1, -1.11111104054623557880e-1, 9.09088713343650656196e-2, -7.69187620504482999495e-2, 6.66107313738753120669e-2, -5.83357013379057348645e-2, 4.97687799461593236017e-2, -3.65315727442169155270e-2, 1.62858201153657823623e-2];

function atanPos(x: number): number {
  let id = -1;
  if (x >= 0.4375) {
    if (x < 1.1875) {
      if (x < 0.6875) {
        id = 0;
        x = (2 * x - 1) / (2 + x);
      } else {
        id = 1;
        x = (x - 1) / (x + 1);
      }
    } else if (x < 2.4375) {
      id = 2;
      x = (x - 1.5) / (1 + 1.5 * x);
    } else {
      id = 3;
      x = -1 / x;
    }
  }
  const z = x * x;
  const w = z * z;
  const s1 = z * (AT[0]! + w * (AT[2]! + w * (AT[4]! + w * (AT[6]! + w * (AT[8]! + w * AT[10]!)))));
  const s2 = w * (AT[1]! + w * (AT[3]! + w * (AT[5]! + w * (AT[7]! + w * AT[9]!))));
  if (id < 0) return x - x * (s1 + s2);
  return ATAN_HI[id]! - (x * (s1 + s2) - ATAN_LO[id]! - x);
}

export function datan2(y: number, x: number): number {
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
  if (x === 0 && y === 0) return 0;
  if (x === 0) return y > 0 ? Math.PI / 2 : -Math.PI / 2;
  const a = atanPos(Math.abs(y / x));
  if (x > 0) return y >= 0 ? a : -a;
  return y >= 0 ? Math.PI - a : -(Math.PI - a);
}

/** Run `fn` with Math.sin/cos/atan2 swapped for the deterministic versions (Matter.js calls them). */
export function withDetMath<T>(fn: () => T): T {
  const m = Math as { sin: (x: number) => number; cos: (x: number) => number; atan2: (y: number, x: number) => number };
  const s = m.sin;
  const c = m.cos;
  const a = m.atan2;
  m.sin = dsin;
  m.cos = dcos;
  m.atan2 = datan2;
  try {
    return fn();
  } finally {
    m.sin = s;
    m.cos = c;
    m.atan2 = a;
  }
}
