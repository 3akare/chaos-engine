/** Parse a Machine's text grid into an indexed Level the engine can run. */
import { idx, parseCell } from '../coords';
import { H, W, type Machine, type Objective } from '../types';

export type CellKind = 'empty' | 'solid' | 'start' | 'target' | 'checkpoint' | 'switch' | 'gate';

export type Level = {
  kinds: CellKind[];
  /** Checkpoint number per cell (0 = none). */
  cp: number[];
  /** Initial gate state per cell (true = open); only meaningful where kinds = 'gate'. */
  gateOpen: boolean[];
  /** Socket flag per cell (§4.10.1: a flag on an empty cell). */
  socket: boolean[];
  /** switch cell index → gate cell indices it toggles. */
  links: Map<number, number[]>;
  start: { x: number; y: number; dx: -1 | 0 | 1 };
  target: { x: number; y: number };
  objective: Objective;
  checkpointCount: number;
};

export class LevelError extends Error {}

export function parseLevel(m: Pick<Machine, 'rows' | 'start' | 'links' | 'objective'>): Level {
  if (m.rows.length !== H) throw new LevelError(`expected ${H} rows, got ${m.rows.length}`);
  const n = W * H;
  const kinds: CellKind[] = new Array<CellKind>(n).fill('empty');
  const cp = new Array<number>(n).fill(0);
  const gateOpen = new Array<boolean>(n).fill(false);
  const socket = new Array<boolean>(n).fill(false);
  let start: Level['start'] | null = null;
  let target: Level['target'] | null = null;
  let maxCp = 0;
  for (let y = 0; y < H; y++) {
    const row = m.rows[y]!;
    if (row.length !== W) throw new LevelError(`row ${y + 1} has ${row.length} chars, expected ${W}`);
    for (let x = 0; x < W; x++) {
      const ch = row[x]!;
      const i = idx(x, y);
      switch (ch) {
        case '.':
          break;
        case '#':
          kinds[i] = 'solid';
          break;
        case 'o':
          socket[i] = true;
          break;
        case 'S':
          if (start) throw new LevelError('more than one Start');
          kinds[i] = 'start';
          start = { x, y, dx: m.start.dx };
          break;
        case 'T':
          if (target) throw new LevelError('more than one Target');
          kinds[i] = 'target';
          target = { x, y };
          break;
        case 'w':
          kinds[i] = 'switch';
          break;
        case 'G':
          kinds[i] = 'gate';
          break;
        case 'g':
          kinds[i] = 'gate';
          gateOpen[i] = true;
          break;
        default:
          if (ch >= '1' && ch <= '9') {
            kinds[i] = 'checkpoint';
            cp[i] = Number(ch);
            maxCp = Math.max(maxCp, cp[i]!);
          } else {
            throw new LevelError(`unknown legend char '${ch}' at row ${y + 1}`);
          }
      }
    }
  }
  if (!start) throw new LevelError('no Start');
  if (!target) throw new LevelError('no Target');
  const links = new Map<number, number[]>();
  for (const l of m.links) {
    const s = parseCell(l.switch);
    if (!s || kinds[idx(s[0], s[1])] !== 'switch') throw new LevelError(`link switch ${l.switch} is not a switch cell`);
    const gates: number[] = [];
    for (const g of l.gates) {
      const c = parseCell(g);
      if (!c || kinds[idx(c[0], c[1])] !== 'gate') throw new LevelError(`link gate ${g} is not a gate cell`);
      gates.push(idx(c[0], c[1]));
    }
    links.set(idx(s[0], s[1]), gates);
  }
  return { kinds, cp, gateOpen, socket, links, start, target, objective: m.objective, checkpointCount: maxCp };
}
