/** Mutable grid used while constructing a machine. */
import { cellName } from '../coords';
import { H, W, type BoardPiece, type Dir, type Machine, type PieceType } from '../types';
import { parseLevel, type Level } from '../sim/level';

export class Grid {
  cells: string[][];
  links: Array<{ switch: string; gates: string[] }> = [];
  constructor(rows?: string[]) {
    this.cells = rows ? rows.map((r) => r.split('')) : Array.from({ length: H }, () => new Array<string>(W).fill('.'));
  }
  clone(): Grid {
    const g = new Grid(this.rows());
    g.links = this.links.map((l) => ({ switch: l.switch, gates: [...l.gates] }));
    return g;
  }
  get(x: number, y: number): string {
    if (x < 0 || x >= W || y < 0 || y >= H) return '#';
    return this.cells[y]![x]!;
  }
  set(x: number, y: number, ch: string): void {
    if (x < 0 || x >= W || y < 0 || y >= H) return;
    this.cells[y]![x] = ch;
  }
  isEmpty(x: number, y: number): boolean {
    return x >= 0 && x < W && y >= 0 && y < H && this.cells[y]![x] === '.';
  }
  rows(): string[] {
    return this.cells.map((r) => r.join(''));
  }
  /** A Level for construction sims; a placeholder target is added if none exists yet. */
  level(dx: -1 | 0 | 1): Level {
    const rows = this.rows();
    if (!rows.some((r) => r.includes('T'))) {
      // Park the placeholder somewhere the construction ball cannot reach first: the bottom-right corner.
      rows[H - 1] = rows[H - 1]!.slice(0, W - 1) + 'T';
    }
    return parseLevel({ rows, start: { dx }, links: this.links, objective: { type: 'DELIVER' } });
  }
}

export type Fix = { x: number; y: number; type: PieceType; dir: Dir };
export const fixToPiece = (f: Fix, i: number): BoardPiece => ({ id: `sol${i}`, type: f.type, dir: f.dir, x: f.x, y: f.y });
export const fixToSolution = (f: Fix): NonNullable<Machine['solution']>[number] => ({ socket: cellName(f.x, f.y), type: f.type, dir: f.dir });
