import { Hono } from 'hono';
import type { AppEnv } from '../app';
import { currentDayId, readMachine, readMeta } from '../core/day';
import { K } from '../core/keys';
import { removeFromBoard } from '../core/board';
import { install, newPostForToday, tick } from '../core/pipeline';

type Ui = { showToast?: string | { text: string; appearance?: 'neutral' | 'success' }; showForm?: unknown; navigateTo?: string };

export function internalRoutes(env: AppEnv): Hono {
  const r = new Hono();
  const { deps } = env;
  const toast = (text: string, ok = true): Ui => ({ showToast: { text, appearance: ok ? 'success' : 'neutral' } });
  const guard = async (fn: () => Promise<Ui>): Promise<Ui> => {
    try {
      return await fn();
    } catch (e) {
      deps.log('error', 'menu action failed', String(e));
      return toast('Something went wrong — check the app logs.', false);
    }
  };

  // Scheduler (devvit.json: every 10 minutes).
  r.post('/cron/tick', async (c) => c.json(await tick(deps)));

  // Trigger: open Day 1 on install.
  r.post('/triggers/on-app-install', async (c) => {
    await install(deps);
    await tick(deps);
    return c.json({ status: 'success' });
  });
  r.post('/triggers/on-app-upgrade', async (c) => {
    await tick(deps);
    return c.json({ status: 'success' });
  });

  // Moderator menu.
  r.post('/menu/new-post', async (c) => c.json(await guard(async () => toast(await newPostForToday(deps)))));
  r.post('/menu/remove-score', async (c) =>
    c.json({
      showForm: {
        name: 'removeScore',
        form: { title: "Remove a player's score", description: "Takes them off today's leaderboard. They can still play.", acceptLabel: 'Remove', fields: [{ name: 'username', label: 'Username', type: 'string', required: true }] },
      },
    }),
  );
  r.post('/form/remove-score', async (c) =>
    c.json(
      await guard(async () => {
        const { username } = (await c.req.json()) as { username?: string };
        const id = await currentDayId(deps.store);
        if (!id) return toast('No Day is running yet.', false);
        return toast(await removeFromBoard(deps, id, String(username ?? '')));
      }),
    ),
  );
  r.post('/menu/show-par', async (c) =>
    c.json(
      await guard(async () => {
        const id = await currentDayId(deps.store);
        const meta = id ? await readMeta(deps.store, id) : null;
        const m = meta ? await readMachine(deps.store, meta.dayNumber) : null;
        if (!m?.gen) return toast('No notes stored for this machine.', false);
        return toast(`Day ${meta!.dayNumber}: the generator's search caught ${m.gen.best}; random builds catch about ${m.gen.random}.`);
      }),
    ),
  );
  r.post('/menu/show-dupes', async (c) =>
    c.json(
      await guard(async () => {
        const d = await deps.store.zRange(K.dupes, 0, 19);
        if (!d.length) return toast('No duplicate posts or comments recorded.');
        return toast(d.map((x) => { const j = JSON.parse(x.member) as { kind: string; dayNumber: number; id: string }; return `Day ${j.dayNumber} ${j.kind} ${j.id}`; }).join(' · '));
      }),
    ),
  );
  return r;
}
