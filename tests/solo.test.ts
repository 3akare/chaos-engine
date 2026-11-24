import { beforeEach, describe, expect, it } from 'vitest';
import { FIXTURES } from '../src/shared/fixtures';
import { DAY_BALLS, runBalls } from '../src/shared/sim/runDay';
import { levelOf, solutionPieces } from '../src/shared/sim/board';
import { client, installWith, makeDeps, type TestEnv } from './server-helpers';

let env: TestEnv;
let api: ReturnType<typeof client>;
const m = FIXTURES[0]!;
beforeEach(async () => {
  env = makeDeps();
  await installWith(env, m);
  api = client(env);
});

describe('solo play', () => {
  it('rolls the three balls on your own arrangement and keeps your best', async () => {
    const expected = runBalls({ level: levelOf(m), pieces: solutionPieces(m) }, DAY_BALLS).score;
    const r = await api.post('/api/solo', { pieces: m.solution });
    expect(r.status).toBe(200);
    expect(r.json.stars).toBe(expected);
    expect(r.json.best).toBe(expected);
    expect(r.json.players).toBe(1);
    // A worse try never lowers your best.
    const empty = await api.post('/api/solo', { pieces: [] });
    expect(empty.json.stars).toBe(0);
    expect(empty.json.best).toBe(expected);
    const view = await api.get('/api/state');
    expect(view.json.solo).toEqual({ best: expected, players: 1, perfect: expected === 3 ? 1 : 0 });
    // Solo never touches the shared board.
    expect(view.json.pieces).toHaveLength(0);
  });

  it('rejects pieces off the + spots, doubled spots and more pieces than the machine has', async () => {
    expect((await api.post('/api/solo', { pieces: [{ socket: 'A1', type: 'RAMP', dir: 'DR' }] })).status).toBe(400);
    const s = m.solution![0]!;
    expect((await api.post('/api/solo', { pieces: [s, s] })).status).toBe(400);
    const tooMany = Object.entries(m.inventory).find(([, n]) => n >= 0)!;
    const type = tooMany[0] as 'RAMP';
    const sockets: string[] = [];
    m.rows.forEach((row, y) => [...row].forEach((ch, x) => ch === 'o' && sockets.push(`${'ABCDEFGHI'[x]}${y + 1}`)));
    const pieces = sockets.slice(0, (m.inventory[type] ?? 0) + 1).map((socket) => ({ socket, type, dir: type === 'RAMP' ? 'DR' : 'U' }));
    if (pieces.length > (m.inventory[type] ?? 0)) expect((await api.post('/api/solo', { pieces })).status).toBe(400);
  });
});
