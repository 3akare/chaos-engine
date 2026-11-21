import { beforeEach, describe, expect, it } from 'vitest';
import { applyAction } from '../src/server/core/placement';
import { K } from '../src/server/core/keys';
import { parseInventory, parsePieces } from '../src/server/core/day';
import { checkInvariant } from '../src/shared/rules/placement';
import { installWith, makeDeps, type TestEnv } from './server-helpers';

let env: TestEnv;
let dayId: string;
const yieldTick = () => new Promise<void>((r) => setImmediate(r));

beforeEach(async () => {
  env = makeDeps();
  dayId = await installWith(env);
  // Interleave every transaction with whatever else is in flight.
  env.store.beforeExec = yieldTick;
});

const state = async () => ({
  pieces: parsePieces(await env.store.hGetAll(K.pieces(dayId))),
  inventory: parseInventory(await env.store.hGetAll(K.inv(dayId))),
  holders: await env.store.hGetAll(K.holder(dayId)),
});

describe('transactional placement', () => {
  it('two concurrent places on the same socket: exactly one wins', async () => {
    const [a, b] = await Promise.all([
      applyAction(env.deps, dayId, { userId: 'a', username: 'alice' }, { kind: 'set', socket: 'I3', type: 'RAMP', dir: 'DL' }),
      applyAction(env.deps, dayId, { userId: 'b', username: 'bob' }, { kind: 'set', socket: 'I3', type: 'RAMP', dir: 'DL' }),
    ]);
    const wins = [a, b].filter((x) => 'ok' in x && x.ok);
    expect(wins).toHaveLength(1);
    const s = await state();
    expect(Object.keys(s.pieces)).toEqual(['I3']);
    expect(checkInvariant(s)).toBeNull();
  });

  it('inventory never goes negative when many players race for the last pieces', async () => {
    await env.store.hSet(K.inv(dayId), { BUMPER: '2' });
    const sockets = ['D3', 'G6', 'E9', 'A11', 'C12', 'H13'];
    const out = await Promise.all(sockets.map((s, i) => applyAction(env.deps, dayId, { userId: `u${i}`, username: `u${i}` }, { kind: 'set', socket: s, type: 'BUMPER', dir: 'L' })));
    const s = await state();
    expect(s.inventory.BUMPER).toBeGreaterThanOrEqual(0);
    expect(Object.values(s.pieces).filter((p) => p.type === 'BUMPER').length).toBe(out.filter((o) => 'ok' in o && o.ok).length);
    expect(Object.values(s.pieces).length).toBeLessThanOrEqual(2);
    expect(checkInvariant(s)).toBeNull();
  });

  it('one piece per player holds when the same player fires several actions at once', async () => {
    await Promise.all(['D3', 'G6', 'E9', 'A11'].map((sock) => applyAction(env.deps, dayId, { userId: 'a', username: 'alice' }, { kind: 'set', socket: sock, type: 'SPRING', dir: 'U' })));
    const s = await state();
    expect(Object.values(s.pieces).filter((p) => p.userId === 'a')).toHaveLength(1);
    expect(checkInvariant(s)).toBeNull();
    expect(s.inventory.SPRING).toBe(1);
  });

  it('a displaced player gets an inbox item', async () => {
    env.store.beforeExec = undefined;
    await applyAction(env.deps, dayId, { userId: 'b', username: 'bob' }, { kind: 'set', socket: 'I3', type: 'BUMPER', dir: 'L' });
    const r = await applyAction(env.deps, dayId, { userId: 'a', username: 'alice' }, { kind: 'set', socket: 'I3', type: 'RAMP', dir: 'DL' });
    if ('ok' in r && r.ok) {
      const inbox = await env.store.zRange(K.inbox('b'), 0, -1);
      expect(inbox).toHaveLength(1);
      expect(JSON.parse(inbox[0]!.member).text).toMatch(/u\/alice replaced your bumper at I3 with a better one\. You're free to place again\./);
    }
  });
});
