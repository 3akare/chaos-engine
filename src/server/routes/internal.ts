import { Hono } from 'hono';
import type { AppEnv } from '../app';
import { currentDayId, readMachine, readMeta } from '../core/day';
import { K } from '../core/keys';
import { regenerateUpcoming } from '../core/levels';
import { install, newPostForToday, runNow, tick } from '../core/pipeline';
import { modRemove } from '../core/placement';
import { seedDemo } from '../core/seed';

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

  // Moderator menu (§6.4).
  r.post('/menu/seed-demo', async (c) => c.json(await guard(async () => toast(await seedDemo(deps)))));
  r.post('/menu/run-now', async (c) =>
    c.json(
      await guard(async () => {
        const rep = await runNow(deps);
        if (!rep.ran) return toast('Another run is in progress — try again in a minute.', false);
        const cur = await currentDayId(deps.store);
        const meta = cur ? await readMeta(deps.store, cur) : null;
        const ui = toast(rep.stages.length ? `Done: ${rep.stages.join(', ')}. Day ${meta?.dayNumber} is open.` : 'Nothing was due.');
        if (meta?.postId) ui.navigateTo = deps.reddit.postUrl(meta.postId);
        return ui;
      }),
    ),
  );
  r.post('/menu/new-post', async (c) => c.json(await guard(async () => toast(await newPostForToday(deps)))));
  r.post('/menu/remove-piece', async (c) =>
    c.json({
      showForm: {
        name: 'removePiece',
        form: { title: 'Remove a piece', description: 'Moderator override: the piece returns to stock and its owner can place again.', acceptLabel: 'Remove', fields: [{ name: 'cell', label: 'Cell (e.g. C7)', type: 'string', required: true }] },
      },
    }),
  );
  r.post('/form/remove-piece', async (c) =>
    c.json(
      await guard(async () => {
        const { cell } = (await c.req.json()) as { cell?: string };
        const id = await currentDayId(deps.store);
        if (!id) return toast('No Day is running yet.', false);
        return toast(await modRemove(deps, id, String(cell ?? '')));
      }),
    ),
  );
  r.post('/menu/regenerate', async (c) =>
    c.json(
      await guard(async () => {
        const id = await currentDayId(deps.store);
        const meta = id ? await readMeta(deps.store, id) : null;
        if (!meta) return toast('No Day is running yet.', false);
        const n = await regenerateUpcoming(deps, meta.dayNumber);
        await tick(deps);
        return toast(`Cleared ${n} upcoming machine(s); they were regenerated with the current generator.`);
      }),
    ),
  );
  r.post('/menu/show-solution', async (c) =>
    c.json(
      await guard(async () => {
        const id = await currentDayId(deps.store);
        const meta = id ? await readMeta(deps.store, id) : null;
        const m = meta ? await readMachine(deps.store, meta.dayNumber) : null;
        if (!m?.solution) return toast('No solution stored.', false);
        return toast(`Day ${meta!.dayNumber}: ${m.solution.map((s) => `${s.type} ${s.dir} @ ${s.socket}`).join(' · ')}`);
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
