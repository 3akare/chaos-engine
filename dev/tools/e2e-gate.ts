/** Phase 3 gate against the running harness: 3 users build, predict, get replaced, advance. */
const BASE = process.env.BASE ?? 'http://localhost:5174';
const call = async (user: string, method: string, path: string, body?: unknown) => {
  const r = await fetch(BASE + path, { method, headers: { cookie: `ce_user=${user}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : null });
  return (await r.json()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
};
const sol = async () => {
  const st = await call('alice', 'GET', '/__harness/status');
  const m = await call('alice', 'GET', `/__harness/machine?day=${st.current.dayNumber}`);
  return { m, postId: st.current.postId as string };
};
await call('alice', 'POST', '/__harness/reset');
const { m, postId } = await sol();
console.log('Day machine:', m.name, 'solution:', JSON.stringify(m.solution));
const users = ['alice', 'bob', 'carol', 'dave'];
// bob first grabs a socket of the 1st solution piece with a wrong/weaker piece, then alice replaces it with the right one.
const s0 = m.solution[0];
const weaker = s0.type === 'SPRING' ? { type: 'FAN', dir: 'U' } : { type: 'SPRING', dir: 'U' };
const wrong = await call('bob', 'POST', '/api/place', { postId, socketId: s0.socket, ...weaker });
console.log('bob weaker piece:', wrong.verdict ?? wrong.message);
for (let i = 0; i < m.solution.length; i++) {
  const s = m.solution[i];
  const u = users[i % 4]!;
  const r = await call(u, 'POST', '/api/place', { postId, socketId: s.socket, type: s.type, dir: s.dir });
  console.log(`${u} places ${s.type} ${s.dir} @ ${s.socket}:`, r.verdict ?? `${r.error}: ${r.message}`);
}
const bobState = await call('bob', 'GET', `/api/state?postId=${postId}`);
// (bob was replaced by alice at step 1, then placed again at step 2)
console.log('bob inbox:', bobState.me.inbox.map((x: { text: string }) => x.text), 'bob socket:', bobState.me.socket);
for (const [u, n] of [['alice', 3], ['bob', 2], ['carol', 1], ['dave', 3]] as const) await call(u, 'POST', '/api/predict', { postId, balls: n });
const pre = await call('alice', 'GET', `/api/state?postId=${postId}`);
console.log('builders', pre.counts.builders, 'predictors', pre.counts.predictors, 'pieces', pre.pieces.length);
console.log('advance:', JSON.stringify(await call('alice', 'POST', '/__harness/advance')));
const post = await call('alice', 'GET', `/api/state?postId=${postId}`);
const r = post.result;
console.log('score', r.score, 'variants', r.variants.join(','), 'perBall', r.perBall.map((b: { end: string }) => b.end).join(','));
console.log('awards', JSON.stringify({ mvp: r.awards.mvp?.username, mostTouched: r.awards.mostTouched?.username, clutch: r.awards.clutch?.username }));
console.log('predictions', r.predictions, 'streak', r.streak, 'current day', post.current.dayNumber);
export {};
