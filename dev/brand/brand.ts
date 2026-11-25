/**
 * The subreddit's icon and banners, drawn with the game's own art: the Kenney balls, the planks,
 * bumpers and bucket from the board, and the logo's fonts. Build and render with:
 *   npx vite build --config dev/brand/vite.config.ts && node dev/brand/render.cjs
 * which writes PNG/JPG files to assets/brand.
 */
import '../../src/client/lib/font.css';
import { artReady, drawBucket, drawBumper, drawPlank, img, INK } from '../../src/client/pour/draw';
import { sprite } from '../../src/client/assets';

type Ctx = CanvasRenderingContext2D;
type Brand = { name: string; w: number; h: number; draw: (c: Ctx, w: number, h: number) => void };

const BALLS = ['ball', 'ball_blue', 'ball_green', 'ball_yellow', 'ball_purple'];
const DISPLAY = '"Lilita One", sans-serif';
const BODY = '"Nunito Variable", sans-serif';

const loaded = (src: string): Promise<HTMLImageElement> =>
  new Promise((ok) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = () => ok(i);
    i.src = src;
  });
let clouds: HTMLImageElement;

/** The game's sky: deep blue at the top fading to pale, clouds along the bottom. */
function sky(c: Ctx, w: number, h: number, cloud = 256): void {
  // The cloud tile's top is solid #c3e3ff, so the sky ends on exactly that colour where the
  // clouds start and there is no seam. Only the tile's lower part (the clouds) is drawn.
  const band = cloud * (332 / 512);
  const g = c.createLinearGradient(0, 0, 0, h - band);
  g.addColorStop(0, '#3d9df2');
  g.addColorStop(0.55, '#6cbcf7');
  g.addColorStop(1, '#c3e3ff');
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += cloud) c.drawImage(clouds, 0, 180, 512, 332, x, h - band, cloud, band);
}

function ball(c: Ctx, x: number, y: number, r: number, n: number): void {
  c.drawImage(img(BALLS[n % BALLS.length]!), x - r, y - r, r * 2, r * 2);
}

/** A plank from the board, in board units (18 thick), scaled by k. */
function plank(c: Ctx, x: number, y: number, len: number, deg: number, k: number): void {
  c.save();
  c.translate(x, y);
  c.scale(k, k);
  c.rotate((deg * Math.PI) / 180);
  drawPlank(c, len, 18);
  c.restore();
}

function bucket(c: Ctx, x: number, y: number, w: number, k: number): void {
  c.save();
  c.translate(x, y);
  c.scale(k, k);
  drawBucket(c, { x: 0, y: 0, w }, 0);
  c.restore();
}

function bumper(c: Ctx, x: number, y: number, k: number): void {
  c.save();
  c.translate(x, y);
  c.scale(k, k);
  drawBumper(c, 0, 0, 0, 17);
  c.restore();
}

/** Outlined display text, like the logo in the post: ink stroke under a white or yellow fill. */
function word(c: Ctx, text: string, x: number, y: number, size: number, fill: string, align: CanvasTextAlign = 'center'): void {
  c.font = `${size}px ${DISPLAY}`;
  c.textAlign = align;
  c.textBaseline = 'alphabetic';
  c.lineJoin = 'round';
  c.miterLimit = 2;
  c.save();
  c.shadowColor = 'rgba(14, 40, 90, 0.35)';
  c.shadowOffsetY = size * 0.06;
  c.shadowBlur = size * 0.08;
  c.lineWidth = size * 0.2;
  c.strokeStyle = INK;
  c.strokeText(text, x, y);
  c.restore();
  c.lineWidth = size * 0.2;
  c.strokeStyle = INK;
  c.strokeText(text, x, y);
  c.fillStyle = fill;
  c.fillText(text, x, y);
}

/** The two-line logo from the post, tilted the same 3 degrees. */
function logo(c: Ctx, cx: number, cy: number, size: number): void {
  c.save();
  c.translate(cx, cy);
  c.rotate((-3 * Math.PI) / 180);
  word(c, 'Chaos', 0, -size * 0.06, size, '#ffffff');
  word(c, 'Engine', 0, size * 0.79, size, '#ffc851');
  c.restore();
}

/** The one-line logo for wide banners. */
function logoLine(c: Ctx, cx: number, cy: number, size: number): void {
  c.save();
  c.translate(cx, cy);
  c.rotate((-2 * Math.PI) / 180);
  c.font = `${size}px ${DISPLAY}`;
  const a = c.measureText('Chaos ').width;
  const b = c.measureText('Engine').width;
  word(c, 'Chaos ', -(a + b) / 2, 0, size, '#ffffff', 'left');
  word(c, 'Engine', -(a + b) / 2 + a, 0, size, '#ffc851', 'left');
  c.restore();
}

/** The tagline on a white pill with an ink edge, like the cards in the post. */
function tagline(c: Ctx, text: string, x: number, y: number, size: number): void {
  c.font = `800 ${size}px ${BODY}`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const w = c.measureText(text).width + size * 1.4;
  const h = size * 1.9;
  c.save();
  c.shadowColor = 'rgba(18, 52, 104, 0.25)';
  c.shadowOffsetY = size * 0.2;
  c.shadowBlur = size * 0.5;
  c.beginPath();
  c.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
  c.fillStyle = 'rgba(255, 255, 255, 0.95)';
  c.fill();
  c.restore();
  c.lineWidth = size * 0.11;
  c.strokeStyle = INK;
  c.stroke();
  c.fillStyle = INK;
  c.fillText(text, x, y + size * 0.04);
}

/** Balls landing in a bucket: a heap inside, a few still falling in. */
function catchScene(c: Ctx, x: number, y: number, k: number, falling: [number, number][]): void {
  const r = 9 * k;
  // The heap sits behind the bucket's front, so draw it first and let the bucket cover it.
  const heap: [number, number][] = [
    [-30, -30], [-12, -33], [6, -31], [24, -30],
    [-21, -46], [-3, -49], [15, -47],
    [-12, -62], [6, -64],
  ];
  heap.forEach(([dx, dy], i) => ball(c, x + dx * k, y + dy * k, r, i + 1));
  bucket(c, x, y, 70, k);
  falling.forEach(([dx, dy], i) => ball(c, x + dx * k, y + dy * k, r, i + 3));
}

const ICON: Brand = {
  name: 'chaos-engine-icon-512.png',
  w: 512,
  h: 512,
  draw(c, w, h) {
    sky(c, w, h, 300);
    // A plank tipping the pour into the bucket: the whole game in one picture. Everything sits
    // inside the circle Reddit crops the icon to.
    plank(c, 178, 150, 108, 16, 1.9);
    [[118, 92, 0], [176, 109, 1]].forEach(([x, y, n]) => ball(c, x!, y!, 28, n!));
    catchScene(c, 262, 384, 2.9, []);
  },
};

const DESKTOP: Brand = {
  name: 'chaos-engine-banner-desktop-1920x384.png',
  w: 1920,
  h: 384,
  draw(c, w, h) {
    sky(c, w, h, 240);
    // Left: the chute and a pour bouncing down planks and a bumper.
    plank(c, 250, 120, 150, 14, 1.5);
    plank(c, 470, 238, 140, -12, 1.5);
    bumper(c, 120, 260, 1.7);
    [[150, 40], [195, 62], [245, 84], [300, 104], [360, 160], [395, 200], [430, 214], [520, 290], [560, 330]].forEach(([x, y], i) => ball(c, x!, y!, 17, i));
    // Right: the bucket catching them.
    plank(c, 1500, 112, 160, 12, 1.5);
    bumper(c, 1790, 150, 1.7);
    [[1400, 50], [1450, 72], [1520, 98], [1590, 120], [1640, 150], [1668, 182]].forEach(([x, y], i) => ball(c, x!, y!, 17, i + 2));
    catchScene(c, 1680, 334, 1.9, []);
    logoLine(c, w / 2, 205, 128);
    tagline(c, '100 balls. One bucket. Catch them all.', w / 2, 290, 30);
  },
};

const MOBILE: Brand = {
  name: 'chaos-engine-banner-mobile-1600x480.png',
  w: 1600,
  h: 480,
  draw(c, w, h) {
    sky(c, w, h, 280);
    plank(c, 230, 150, 150, 14, 1.7);
    bumper(c, 120, 330, 2);
    [[110, 50], [160, 76], [215, 102], [280, 128], [345, 190], [370, 250], [380, 310]].forEach(([x, y], i) => ball(c, x!, y!, 20, i));
    plank(c, 1360, 130, 150, 12, 1.7);
    [[1250, 60], [1310, 86], [1380, 112], [1450, 140], [1480, 190], [1490, 240]].forEach(([x, y], i) => ball(c, x!, y!, 20, i + 2));
    catchScene(c, 1430, 424, 2.1, []);
    logo(c, w / 2, 178, 140);
    tagline(c, '100 balls. One bucket. Catch them all.', w / 2, 410, 34);
  },
};

async function main(): Promise<void> {
  clouds = await loaded(sprite('bg_clouds'));
  await artReady();
  await document.fonts.load(`100px ${DISPLAY}`);
  await document.fonts.load(`800 40px ${BODY}`);
  const out: Record<string, string> = {};
  for (const b of [ICON, DESKTOP, MOBILE]) {
    const canvas = document.createElement('canvas');
    canvas.width = b.w;
    canvas.height = b.h;
    canvas.style.cssText = 'display:block;margin:12px;max-width:95vw';
    const c = canvas.getContext('2d')!;
    b.draw(c, b.w, b.h);
    document.body.append(canvas);
    out[b.name] = canvas.toDataURL('image/png');
  }
  Object.assign(window, { brandImages: out });
}

void main();
