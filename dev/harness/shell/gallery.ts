/** Seed gallery (§5.7): the next 30 generated Days, with tier, families, Play solution and pinning. */
import { drawMini } from '../../../src/client/lib/miniBoard';
import { levelOf, simulate, solutionPieces } from '../../../src/shared/sim';
import type { Machine } from '../../../src/shared/types';

type Day = { dayNumber: number; stored: boolean; pinned: number | null; machine: Machine; solutionDelivers: number; ms: number };
const $ = (id: string) => document.getElementById(id)!;
const gears = (t: number) => '⚙'.repeat(t) + '·'.repeat(3 - t);

function thumb(canvas: HTMLCanvasElement, m: Machine, withSolution: boolean): void {
  const level = levelOf(m);
  const pieces = withSolution ? solutionPieces(m) : [];
  const r = simulate(level, pieces);
  drawMini(canvas, m.rows, {
    target: m.target ?? 'bell',
    pieces: withSolution ? (m.solution ?? []) : [],
    path: r.frames,
    pathColor: withSolution ? '#2fa36b' : '#e5484d',
  });
}

async function load(): Promise<void> {
  const res = await fetch('/__harness/gallery?count=30');
  const data = (await res.json()) as { current: number; days: Day[] };
  const total = data.days.reduce((a, d) => a + d.ms, 0);
  $('info').textContent = `Day ${data.current} is live · generated ${data.days.filter((d) => !d.stored).length} previews in ${total} ms`;
  const grid = $('grid');
  grid.innerHTML = '';
  const showSol = ($('showsol') as HTMLInputElement).checked;
  for (const d of data.days) {
    const m = d.machine;
    const card = document.createElement('div');
    card.className = `card${d.dayNumber === data.current ? ' current' : ''}`;
    const canvas = document.createElement('canvas');
    card.append(canvas);
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.innerHTML = `<b>Day ${d.dayNumber} · ${m.name}</b><br>${gears(m.gen?.tier ?? 1)} tier ${m.gen?.tier} · ${m.objective.type === 'DELIVER' ? 'deliver' : `${m.objective.count} checkpoints`}<br>${(m.gen?.families ?? []).join(' › ')}<br>attempt ${m.gen?.attempt}${m.gen?.fallback ? ' · FALLBACK' : ''} · solution beats ${d.solutionDelivers}/6 variants ${d.pinned !== null ? `<span class="pin">· pinned</span>` : ''}${d.stored ? ' · stored' : ''}`;
    card.append(meta);
    const row = document.createElement('div');
    row.className = 'row';
    const play = document.createElement('button');
    play.textContent = '▶ Play solution';
    play.onclick = () => window.open(`/sandbox?day=${d.dayNumber}&solution=1`, '_blank');
    row.append(play);
    if (d.dayNumber > data.current) {
      const alt = document.createElement('button');
      alt.className = 'alt';
      alt.textContent = 'Alternatives…';
      alt.onclick = () => void alternatives(d.dayNumber);
      row.append(alt);
    }
    card.append(row);
    grid.append(card);
    requestAnimationFrame(() => thumb(canvas, m, showSol));
  }
}

async function alternatives(day: number): Promise<void> {
  $('alts').style.display = 'flex';
  $('altTitle').textContent = `Day ${day}: finding validated attempts…`;
  const opts = $('altOpts');
  opts.innerHTML = '';
  const res = await fetch(`/__harness/alternatives?day=${day}`);
  const data = (await res.json()) as { alternatives: Array<{ attempt: number; machine: Machine }> };
  $('altTitle').textContent = `Day ${day}: pick a validated attempt to pin`;
  for (const a of data.alternatives) {
    const box = document.createElement('div');
    const c = document.createElement('canvas');
    box.append(c);
    const b = document.createElement('button');
    b.textContent = `Pin attempt ${a.attempt} · ${a.machine.name}`;
    b.onclick = async () => {
      await fetch('/__harness/pin', { method: 'POST', body: JSON.stringify({ day, attempt: a.attempt }) });
      $('alts').style.display = 'none';
      await load();
    };
    box.append(document.createElement('br'), b);
    opts.append(box);
    requestAnimationFrame(() => thumb(c, a.machine, false));
  }
  const un = document.createElement('button');
  un.className = 'alt';
  un.textContent = 'Clear pin';
  un.onclick = async () => {
    await fetch('/__harness/pin', { method: 'POST', body: JSON.stringify({ day, attempt: null }) });
    $('alts').style.display = 'none';
    await load();
  };
  opts.append(un);
}

$('altClose').onclick = () => ($('alts').style.display = 'none');
$('showsol').onchange = () => void load();
void load();
