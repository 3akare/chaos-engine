const BASE = 'http://localhost:5174';
const call = async (user: string, method: string, path: string, body?: unknown) => {
  const r = await fetch(BASE + path, { method, headers: { cookie: `ce_user=${user}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : null });
  return (await r.json()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
};
const st = await call('alice', 'GET', '/__harness/status');
const m = await call('alice', 'GET', `/__harness/machine?day=${st.current.dayNumber}`);
const postId = st.current.postId;
const s0 = m.solution[0];
const opts = [['RAMP', 'DL'], ['RAMP', 'DR'], ['BUMPER', 'L'], ['BUMPER', 'R'], ['FAN', 'L'], ['FAN', 'R'], ['FAN', 'U'], ['SPRING', 'U'], ['SPRING', 'UL'], ['SPRING', 'UR']].filter(([t, d]) => !(t === s0.type && d === s0.dir));
for (const [type, dir] of opts) {
  const r = await call('bob', 'POST', '/api/place', { postId, socketId: s0.socket, type, dir });
  if (r.ok) { console.log(`bob placed ${type} ${dir} @ ${s0.socket}: ${r.verdict}`); break; }
}
const a = await call('alice', 'POST', '/api/place', { postId, socketId: s0.socket, type: s0.type, dir: s0.dir });
console.log('alice replaces:', a.verdict ?? a.message);
const bob = await call('bob', 'GET', `/api/state?postId=${postId}`);
console.log('bob socket now:', bob.me.socket, '| inbox:', bob.me.inbox.map((x: { text: string }) => x.text));
const s1 = m.solution[1];
const again = await call('bob', 'POST', '/api/place', { postId, socketId: s1.socket, type: s1.type, dir: s1.dir });
console.log('bob places again:', again.verdict ?? again.message);
export {};
