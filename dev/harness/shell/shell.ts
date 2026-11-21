/** Harness shell: a phone frame showing a post, plus dev controls (§6.5). */
type Status = { now: number; user: string; current: { dayNumber: number; postId?: string; status: string } | null; days: Array<{ dayNumber: number; status: string; postId?: string; title: string }> };
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const qs = new URLSearchParams(location.search);
let selected: string | null = qs.get('postId');

const log = (s: string) => {
  $('log').textContent = `${new Date().toLocaleTimeString()} ${s}\n${$('log').textContent}`;
};
const post = async (path: string, body?: unknown) => {
  const r = await fetch(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
  return r.json() as Promise<unknown>;
};

function show(postId: string | null, view = 'splash'): void {
  selected = postId;
  const u = new URL(location.href);
  if (postId) u.searchParams.set('postId', postId);
  history.replaceState(null, '', u);
  const dark = ($('dark') as HTMLInputElement).checked ? '&theme=dark' : '';
  $<HTMLIFrameElement>('frame').src = `/${view}.html?postId=${postId ?? ''}${dark}`;
  void refresh();
}

async function refresh(): Promise<void> {
  const s = (await (await fetch('/__harness/status')).json()) as Status;
  const ul = $('days');
  ul.innerHTML = '';
  for (const d of [...s.days].reverse()) {
    const li = document.createElement('li');
    li.textContent = `${d.title} — ${d.status}`;
    if (d.postId === selected) li.className = 'sel';
    li.onclick = () => show(d.postId ?? null);
    ul.append(li);
  }
  if (!selected && s.current?.postId) show(s.current.postId);
}

const cookieUser = document.cookie.split('; ').find((c) => c.startsWith('ce_user='))?.slice(8);
if (cookieUser) $<HTMLSelectElement>('user').value = decodeURIComponent(cookieUser);
$('user').onchange = async () => {
  await post('/__harness/user', { name: $<HTMLSelectElement>('user').value });
  log(`switched to u/${$<HTMLSelectElement>('user').value}`);
  show(selected);
};
$('seed').onclick = async () => {
  log(JSON.stringify(await post('/__harness/seed')));
  show(selected);
};
$('advance').onclick = async () => {
  log(JSON.stringify(await post('/__harness/advance')));
  show(selected);
};
$('reset').onclick = async () => {
  log(JSON.stringify(await post('/__harness/reset')));
  selected = null;
  await refresh();
};
$('dark').onchange = () => {
  $('phone').classList.toggle('dark', ($('dark') as HTMLInputElement).checked);
  show(selected);
};
window.addEventListener('message', (e: MessageEvent<{ type: string; postId?: string }>) => {
  if (e.data?.type === 'harness:navigate' && e.data.postId) show(e.data.postId.startsWith('t3_') ? e.data.postId : `t3_${e.data.postId}`, 'game');
});
void refresh();
