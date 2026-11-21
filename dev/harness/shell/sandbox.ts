/** Phase 1 sandbox: render a fixture, drop pieces freely (no rules), play test runs. */
import * as Phaser from 'phaser';
import { BoardScene, type ScenePiece } from '../../../src/client/game/scenes/BoardScene';
import { FIXTURES } from '../../../src/shared/fixtures';
import { levelOf, simulate, solutionPieces, VARIANTS } from '../../../src/shared/sim';
import { cellName } from '../../../src/shared/coords';
import type { Dir, PieceType, VariantId } from '../../../src/shared/types';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const CYCLE: Array<[PieceType, Dir] | null> = [
  null,
  ['RAMP', 'DR'], ['RAMP', 'DL'],
  ['SPRING', 'U'], ['SPRING', 'UR'], ['SPRING', 'UL'],
  ['FAN', 'R'], ['FAN', 'L'], ['FAN', 'U'],
  ['BUMPER', 'R'], ['BUMPER', 'L'],
];

const qs = new URLSearchParams(location.search);
let fi = Number(qs.get('fixture') ?? 0);
let pieces: ScenePiece[] = [];
let speed = 1;
let seq = 0;

const scene = new BoardScene();
new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'board',
  transparent: true,
  scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
  scene: [scene],
  banner: false,
});

for (const [i, f] of FIXTURES.entries()) $('fixture').append(new Option(f.name, String(i)));
for (const v of ['STANDARD', ...VARIANTS.map((x) => x.id)]) $('variant').append(new Option(v, v));
($('fixture') as HTMLSelectElement).value = String(fi);

const level = () => levelOf(FIXTURES[fi]!);
const show = () => {
  scene.setBoard(level(), pieces, FIXTURES[fi]!.target ?? 'bell');
  const r = simulate(level(), pieces);
  scene.setGhost(undefined, r);
  $('status').textContent = `Ball 1 now: ${r.end} after ${r.ticks} ticks · P=[${r.progress.join(', ')}]`;
};

scene.onReady = show;
scene.onTap = (x, y) => {
  if (!level().socket[y * 9 + x]) {
    $('status').textContent = `${cellName(x, y)} is not a socket.`;
    return;
  }
  const cur = pieces.find((p) => p.x === x && p.y === y);
  const k = cur ? CYCLE.findIndex((c) => c && c[0] === cur.type && c[1] === cur.dir) : 0;
  const next = CYCLE[(k + 1) % CYCLE.length];
  pieces = pieces.filter((p) => p !== cur);
  if (next) pieces.push({ id: `s${seq++}`, type: next[0], dir: next[1], x, y, owner: 'sandbox' });
  show();
};
$('fixture').onchange = () => {
  fi = Number(($('fixture') as HTMLSelectElement).value);
  pieces = [];
  show();
};
$('run').onclick = async () => {
  const v = ($('variant') as HTMLSelectElement).value as VariantId;
  const r = simulate(level(), pieces, { variant: v });
  scene.setGhost(undefined, undefined);
  $('status').textContent = `Running ${v}…`;
  await scene.playRun(r, { speed, showOwners: true });
  $('status').textContent = `${v}: ${r.end} after ${r.ticks} ticks`;
  scene.setGhost(undefined, r);
};
$('speed').onclick = () => {
  speed = speed === 1 ? 2 : speed === 2 ? 4 : 1;
  $('speed').textContent = `${speed}×`;
};
$('solution').onclick = () => {
  pieces = solutionPieces(FIXTURES[fi]!).map((p) => ({ ...p, owner: 'solution' }));
  show();
};
$('clear').onclick = () => {
  pieces = [];
  show();
};
