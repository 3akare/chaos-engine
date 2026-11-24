/**
 * The pour: Matter.js physics stepped at a fixed 1/60 s with deterministic trig, so the same
 * machine and build give the same score on every phone and on the server.
 */
import Matter from 'matter-js';
import { withDetMath } from './detmath';
import { BALL_R, BALLS, H, type Machine, type Piece, W } from './types';

const { Engine, Bodies, Body, Composite, Events, Bounds } = Matter;
type Body = Matter.Body;

export type Ball = Body & { n: number; caught?: boolean; caughtAt?: number; kickedAt?: number };

export type PourEvent =
  | { k: 'catch'; x: number; y: number; n: number }
  | { k: 'lost' }
  | { k: 'spring'; piece: number }
  | { k: 'bumper'; piece: number }
  | { k: 'hit'; speed: number };

const STEP_MS = 1000 / 60;
/** One new ball every this many steps (100 balls ≈ 5 s). */
const SPAWN_EVERY = 3;
/** Hard stop: 40 s of pour. */
export const MAX_STEPS = 60 * 40;
const SETTLE_STEPS = 180;
const SPEED_CAP = 14;
const SPRING_V = 11;
const BUMPER_V = 8.5;

const rad = (deg: number): number => (deg * Math.PI) / 180;
const pieceOf = (b: Body): number => (b as Body & { piece?: number }).piece ?? -1;

function rect(x: number, y: number, w: number, h: number, a: number, opts: Matter.IChamferableBodyDefinition = {}): Body {
  return Bodies.rectangle(x, y, w, h, { isStatic: true, angle: rad(a), friction: 0.002, frictionStatic: 0, restitution: 0.3, ...opts });
}

function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

/** Spring body: covers the drawn spring, offset up from the piece's anchor. */
export function springCentre(p: Piece): { x: number; y: number } {
  const ar = rad(p.a);
  return { x: p.x + Math.sin(ar) * 12, y: p.y - Math.cos(ar) * 12 };
}

export class Pour {
  readonly engine: Matter.Engine;
  readonly balls: Ball[] = [];
  readonly spinners: { s: Machine['spinners'][number]; body: Body }[];
  readonly events: PourEvent[] = [];
  spawned = 0;
  caught = 0;
  lost = 0;
  /** How close lost balls fell to the bucket (0..1 each). Only used to guide the generator's search. */
  near = 0;
  t = 0;
  done = false;
  private settle = 0;
  private readonly sensor: Body;
  private readonly fans: { x: number; y: number; ax: number; ay: number }[] = [];
  private readonly rand: () => number;

  constructor(
    readonly machine: Machine,
    readonly pieces: readonly Piece[],
  ) {
    this.rand = lcg(machine.seed);
    this.engine = Engine.create({ gravity: { x: 0, y: 1, scale: 0.001 }, positionIterations: 10, velocityIterations: 8 });
    const m = machine;
    const built = withDetMath(() => {
      const statics: Body[] = [];
      for (const b of m.blocks) statics.push(rect(b.x, b.y, b.w, b.h, b.a, { label: 'block' }));
      for (const [x, y] of m.pegs) statics.push(Bodies.circle(x, y, 7, { isStatic: true, restitution: 0.5, label: 'peg' }));
      // Side walls only near the top; the floor is open except for the bucket.
      statics.push(rect(-10, 150, 20, 300, 0, { label: 'edge' }), rect(W + 10, 150, 20, 300, 0, { label: 'edge' }));
      const bk = m.bucket;
      statics.push(
        rect(bk.x - bk.w / 2 - 4, bk.y - 6, 8, 52, 0, { label: 'bucket' }),
        rect(bk.x + bk.w / 2 + 4, bk.y - 6, 8, 52, 0, { label: 'bucket' }),
        rect(bk.x, bk.y + 20, bk.w + 16, 8, 0, { label: 'bucket' }),
      );
      const sensor = Bodies.rectangle(bk.x, bk.y + 4, bk.w, 26, { isStatic: true, isSensor: true, label: 'catch' });
      const spinners = m.spinners.map((s) => ({ s, body: Bodies.rectangle(s.x, s.y, s.len, 12, { isStatic: true, label: 'spinner', restitution: 0.4 }) }));
      const pieceBodies: Body[] = [];
      this.pieces.forEach((p, i) => {
        if (p.type === 'ramp') pieceBodies.push(rect(p.x, p.y, 84, 12, p.a, { label: 'ramp', friction: 0.02 }));
        if (p.type === 'spring') {
          const c = springCentre(p);
          const b = rect(c.x, c.y, 40, 34, p.a, { label: 'spring', restitution: 0.2 });
          (b as Body & { piece: number }).piece = i;
          pieceBodies.push(b);
        }
        if (p.type === 'bumper') {
          const b = Bodies.circle(p.x, p.y, 17, { isStatic: true, label: 'bumper', restitution: 1.1 });
          (b as Body & { piece: number }).piece = i;
          pieceBodies.push(b);
        }
        if (p.type === 'fan') {
          pieceBodies.push(Bodies.circle(p.x, p.y, 15, { isStatic: true, label: 'fanbody' }));
          this.fans.push({ x: p.x, y: p.y, ax: Math.cos(rad(p.a)), ay: Math.sin(rad(p.a)) });
        }
      });
      Composite.add(this.engine.world, [...statics, sensor, ...spinners.map((s) => s.body), ...pieceBodies]);
      return { sensor, spinners };
    });
    this.sensor = built.sensor;
    this.spinners = built.spinners;
    this.wire();
  }

  private wire(): void {
    const pairBall = (pr: Matter.Pair): [Ball, Body] | null => {
      const a = pr.bodyA;
      const b = pr.bodyB;
      if (a.label === 'ball') return [a as Ball, b];
      if (b.label === 'ball') return [b as Ball, a];
      return null;
    };
    // Balls resting on or pushed onto a spring get launched too, not only on first contact.
    Events.on(this.engine, 'collisionActive', (ev) => {
      for (const pr of ev.pairs) {
        const p = pairBall(pr);
        if (p && p[1].label === 'spring') this.springKick(p[0], p[1], false);
      }
    });
    Events.on(this.engine, 'collisionStart', (ev) => {
      for (const pr of ev.pairs) {
        const p = pairBall(pr);
        if (!p) continue;
        const [ball, other] = p;
        if (other.label === 'catch') continue;
        if (other.label === 'spring') {
          if (!this.springKick(ball, other, true)) this.events.push({ k: 'hit', speed: ball.speed });
        } else if (other.label === 'bumper') {
          const dx = ball.position.x - other.position.x;
          const dy = ball.position.y - other.position.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          Body.setVelocity(ball, { x: (dx / d) * BUMPER_V, y: (dy / d) * BUMPER_V });
          this.events.push({ k: 'bumper', piece: pieceOf(other) });
        } else this.events.push({ k: 'hit', speed: ball.speed });
      }
    });
  }

  private springSound = new Map<number, number>();

  /** Launch a ball touching the spring's pad (its top face) straight out along the spring. */
  private springKick(ball: Ball, spring: Body, first: boolean): boolean {
    const ux = Math.sin(spring.angle);
    const uy = -Math.cos(spring.angle);
    const rx = ball.position.x - spring.position.x;
    const ry = ball.position.y - spring.position.y;
    if (rx * ux + ry * uy < 10) return false; // the side or the base: a normal bounce
    if (ball.kickedAt !== undefined && this.t - ball.kickedAt < 6) return true;
    ball.kickedAt = this.t;
    const tx = -uy;
    const ty = ux;
    const side = (ball.velocity.x * tx + ball.velocity.y * ty) * 0.25;
    Body.setVelocity(ball, { x: ux * SPRING_V + tx * side, y: uy * SPRING_V + ty * side });
    const i = pieceOf(spring);
    if (first || this.t - (this.springSound.get(i) ?? -99) > 8) {
      this.events.push({ k: 'spring', piece: i });
      this.springSound.set(i, this.t);
    }
    return true;
  }

  /** One fixed step. Events from it are appended to `events` (the caller clears them). */
  step(): void {
    if (this.done) return;
    withDetMath(() => this.stepInner());
  }

  private stepInner(): void {
    const sp = this.machine.spawn;
    if (this.spawned < BALLS && this.t % SPAWN_EVERY === 0) {
      const b = Bodies.circle(sp.x + (this.rand() - 0.5) * 14, sp.y, BALL_R, { restitution: 0.45, friction: 0.002, frictionStatic: 0, frictionAir: 0.002, density: 0.002, label: 'ball' }) as Ball;
      Body.setVelocity(b, { x: sp.vx + (this.rand() - 0.5) * 0.8, y: 1 });
      b.n = this.spawned;
      Composite.add(this.engine.world, b);
      this.balls.push(b);
      this.spawned++;
    }
    for (const { s, body } of this.spinners) {
      Body.setAngle(body, body.angle + s.speed);
      Body.setAngularVelocity(body, s.speed);
    }
    // Fans push balls in a beam about three balls wide, strongest close up.
    for (const f of this.fans) {
      for (const b of this.balls) {
        const dx = b.position.x - f.x;
        const dy = b.position.y - f.y;
        const along = dx * f.ax + dy * f.ay;
        const side = -dx * f.ay + dy * f.ax;
        if (along > 8 && along < 150 && Math.abs(side) < 26) {
          const k = 0.00042 * (1 - along / 170);
          Body.applyForce(b, b.position, { x: f.ax * k, y: f.ay * k });
        }
      }
    }
    Engine.update(this.engine, STEP_MS);
    this.t++;
    for (const b of this.balls) {
      if (b.speed > SPEED_CAP) Body.setVelocity(b, { x: (b.velocity.x / b.speed) * SPEED_CAP, y: (b.velocity.y / b.speed) * SPEED_CAP });
    }
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i]!;
      if (!b.caught && Bounds.contains(this.sensor.bounds, b.position)) {
        b.caught = true;
        b.caughtAt = this.t;
        this.caught++;
        this.events.push({ k: 'catch', x: b.position.x, y: b.position.y, n: this.caught });
      }
      if (b.caught && this.t - b.caughtAt! > 40) {
        Composite.remove(this.engine.world, b);
        this.balls.splice(i, 1);
        continue;
      }
      if (b.position.y > H + 40 || b.position.x < -60 || b.position.x > W + 60) {
        Composite.remove(this.engine.world, b);
        this.balls.splice(i, 1);
        this.lost++;
        if (b.position.y > H) this.near += Math.max(0, 1 - Math.abs(b.position.x - this.machine.bucket.x) / W);
        this.events.push({ k: 'lost' });
      }
    }
    // Done when every ball has spawned and the rest are caught, lost, or still for 3 s.
    if (this.spawned >= BALLS) {
      const moving = this.balls.some((b) => !b.caught && b.speed > 0.25);
      this.settle = moving ? 0 : this.settle + 1;
      if (this.balls.every((b) => b.caught) || this.settle > SETTLE_STEPS || this.t >= MAX_STEPS) this.done = true;
    }
  }
}

/** Run a whole pour without drawing it. */
export function runPourDetail(machine: Machine, pieces: readonly Piece[]): { caught: number; near: number; steps: number } {
  const p = new Pour(machine, pieces);
  while (!p.done) {
    p.step();
    p.events.length = 0;
  }
  return { caught: p.caught, near: p.near, steps: p.t };
}

/** Balls caught (0..100). */
export const runPour = (machine: Machine, pieces: readonly Piece[]): number => runPourDetail(machine, pieces).caught;
