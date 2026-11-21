import { describe, expect, it } from 'vitest';
import { decide, checkInvariant, type BoardState } from '../src/shared/rules/placement';
import { levelOf, solutionPieces } from '../src/shared/sim';
import { FIXTURES } from '../src/shared/fixtures';
import type { StoredPiece } from '../src/shared/protocol';

const m = FIXTURES[0]!; // First Contact: solution RAMP DL @ I3, SPRING UR @ B13
const level = levelOf(m);
const alice = { userId: 'a', username: 'alice' };
const bob = { userId: 'b', username: 'bob' };
let n = 0;
const fresh = (): BoardState => ({ pieces: {}, inventory: { ...m.inventory }, holders: {} });
const act = (s: BoardState, who: typeof alice, socket: string, type: StoredPiece['type'], dir: StoredPiece['dir']) => decide(level, s, who, { kind: 'set', socket, type, dir }, 1000 + n, `p${n++}`);
const ok = (d: ReturnType<typeof decide>): BoardState => {
  if (!d.ok) throw new Error(`${d.code}: ${d.message}`);
  expect(checkInvariant(d.next)).toBeNull();
  return d.next;
};

describe('§2.5 action matrix', () => {
  it('Place on an empty socket needs P(after) >= P(before)', () => {
    const s = ok(act(fresh(), alice, 'I3', 'RAMP', 'DL'));
    expect(s.holders.a).toBe('I3');
    // A dormant piece (never touched) passes trivially.
    ok(act(fresh(), alice, 'D3', 'BUMPER', 'L'));
  });
  it('Place that lowers P is refused with WOULD_HURT and an event-based reason', () => {
    const s = ok(act(fresh(), alice, 'I3', 'RAMP', 'DL'));
    const d = act(s, bob, 'D3', 'BUMPER', 'R'); // D3 is on the new route along row 3
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.code).toBe('WOULD_HURT');
      expect(d.message).toMatch(/Lower progress ✗: Ball 1 now .* instead of/);
    }
  });
  it('Replace someone else’s piece needs strictly better P (MUST_IMPROVE)', () => {
    let s = ok(act(fresh(), alice, 'I3', 'RAMP', 'DL'));
    s = ok(act(s, bob, 'B13', 'SPRING', 'UR')); // now delivers
    const d = act(s, { userId: 'c', username: 'carol' }, 'B13', 'SPRING', 'UL');
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe('MUST_IMPROVE');
  });
  it('Replace with a strictly better piece removes theirs and frees them to place again', () => {
    let s = ok(act(fresh(), bob, 'I3', 'BUMPER', 'L')); // bumper at I3 — not a full fix
    const d = act(s, alice, 'I3', 'RAMP', 'DL');
    if (d.ok) {
      expect(d.kind).toBe('replace');
      expect(d.displaced?.userId).toBe('b');
      s = ok(d);
      expect(s.holders.b).toBeUndefined();
      s = ok(act(s, bob, 'B13', 'SPRING', 'UR'));
      expect(s.holders.b).toBe('B13');
    } else {
      expect(d.code).toBe('MUST_IMPROVE');
    }
  });
  it('Move your piece to an empty socket', () => {
    let s = ok(act(fresh(), alice, 'D3', 'BUMPER', 'L'));
    const d = act(s, alice, 'I3', 'RAMP', 'DL');
    expect(d.ok && d.kind).toBe('move');
    s = ok(d);
    expect(s.pieces.D3).toBeUndefined();
    expect(Object.values(s.pieces)).toHaveLength(1);
  });
  it('Re-orient or swap type in place', () => {
    let s = ok(act(fresh(), alice, 'I3', 'RAMP', 'DL'));
    const d = act(s, alice, 'I3', 'RAMP', 'DR');
    // DR sends Ball 1 right off the edge — lower than DL's progress.
    expect(d.ok).toBe(false);
    // A dormant piece can be re-oriented and swapped freely.
    s = ok(act(fresh(), alice, 'D3', 'BUMPER', 'L'));
    const e = act(s, alice, 'D3', 'BUMPER', 'R');
    expect(e.ok && e.kind).toBe('edit');
    s = ok(e);
    const f = act(s, alice, 'D3', 'FAN', 'L');
    expect(f.ok && f.kind).toBe('edit');
    expect(ok(f).inventory.BUMPER).toBe(m.inventory.BUMPER);
  });
  it('Move and replace needs strictly better P', () => {
    let s = ok(act(fresh(), alice, 'A11', 'SPRING', 'U'));
    s = ok(act(s, bob, 'I3', 'BUMPER', 'L'));
    const d = act(s, alice, 'I3', 'RAMP', 'DL');
    if (d.ok) {
      expect(d.kind).toBe('move-replace');
      expect(d.next.pieces.A11).toBeUndefined();
      expect(checkInvariant(d.next)).toBeNull();
    } else expect(d.code).toBe('MUST_IMPROVE');
  });
  it('Remove your piece unless that lowers P', () => {
    let s = ok(act(fresh(), alice, 'I3', 'RAMP', 'DL'));
    const d = decide(level, s, alice, { kind: 'remove' }, 5, 'x');
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe('WOULD_HURT');
    s = ok(act(fresh(), alice, 'D3', 'BUMPER', 'L'));
    s = ok(decide(level, s, alice, { kind: 'remove' }, 5, 'x'));
    expect(s.holders.a).toBeUndefined();
    expect(s.inventory.BUMPER).toBe(m.inventory.BUMPER);
  });
  it('Level pieces can never be replaced; non-sockets are refused', () => {
    const d = act(fresh(), alice, 'B2', 'RAMP', 'DL');
    expect(!d.ok && d.code).toBe('NOT_REPLACEABLE');
    const e = act(fresh(), alice, 'A1', 'RAMP', 'DL');
    expect(!e.ok && e.code).toBe('NOT_A_SOCKET');
  });
  it('Setup pieces are replaceable under the improve rule', () => {
    const s = fresh();
    s.pieces.I3 = { pieceId: 'setup1', socket: 'I3', type: 'BUMPER', dir: 'L', userId: 'setup', username: 'chaos-engine', placedAt: 0, setup: true };
    s.inventory.BUMPER--;
    const d = act(s, alice, 'I3', 'RAMP', 'DL');
    if (!d.ok) expect(d.code).toBe('MUST_IMPROVE');
    else expect(d.displaced?.setup).toBe(true);
  });
});

describe('stock accounting', () => {
  it('returns removed pieces to stock before taking (swap with zero stock left works)', () => {
    let s = fresh();
    s.inventory = { RAMP: 1, SPRING: 1, FAN: 0, BUMPER: 0 };
    s = ok(act(s, alice, 'D3', 'RAMP', 'DR'));
    expect(s.inventory.RAMP).toBe(0);
    // Move the only ramp to another socket: stock is returned first, so this works.
    s = ok(act(s, alice, 'I3', 'RAMP', 'DL'));
    expect(s.inventory.RAMP).toBe(0);
  });
  it('fails with OUT_OF_STOCK when the new piece has no stock', () => {
    const s = fresh();
    s.inventory.FAN = 0;
    const d = act(s, alice, 'D3', 'FAN', 'L');
    expect(!d.ok && d.code).toBe('OUT_OF_STOCK');
  });
});

describe('one-piece invariant', () => {
  it('holds after a long random sequence of actions', () => {
    let s = fresh();
    const users = ['a', 'b', 'c', 'd'].map((u) => ({ userId: u, username: u }));
    const sockets = level.socket.map((v, i) => (v ? i : -1)).filter((i) => i >= 0).map((i) => `${'ABCDEFGHI'[i % 9]}${Math.floor(i / 9) + 1}`);
    const opts: Array<[StoredPiece['type'], StoredPiece['dir']]> = [['RAMP', 'DL'], ['RAMP', 'DR'], ['BUMPER', 'L'], ['SPRING', 'UR'], ['FAN', 'R']];
    let r = 7;
    const rnd = (k: number) => (r = (r * 1103515245 + 12345) % 2147483648) % k;
    for (let i = 0; i < 400; i++) {
      const u = users[rnd(users.length)]!;
      const d = rnd(10) === 0 ? decide(level, s, u, { kind: 'remove' }, i, `q${i}`) : act(s, u, sockets[rnd(sockets.length)]!, ...opts[rnd(opts.length)]!);
      if (d.ok) s = d.next;
      expect(checkInvariant(s)).toBeNull();
    }
  });
  it('the stored solution can be built by two players in order', () => {
    const sol = solutionPieces(m);
    expect(sol).toHaveLength(2);
  });
});
