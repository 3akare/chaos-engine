/** Expanded game entry (game.html): Phaser board + DOM controls. */
import * as Phaser from 'phaser';
import { context } from '@devvit/web/client';
import { BoardScene, PX } from './scenes/BoardScene';
import { GameApp } from './app';
import './game.css';

const qs = new URLSearchParams(location.search);
const root = document.getElementById('app')!;
const scene = new BoardScene();
const postId = context.postId ?? qs.get('postId') ?? undefined;
const app = new GameApp(root, scene, postId);
scene.onReady = () => {
  app.start().catch((e: unknown) => {
    root.textContent = `Something went wrong loading the machine. ${String(e)}`;
  });
};

// Sharp on every phone: the canvas has the screen's real pixel count and is shown at 1/PX zoom.
const board = app.boardElement();
const size = (): [number, number] => [Math.max(1, Math.round(board.clientWidth * PX)), Math.max(1, Math.round(board.clientHeight * PX))];

// The board draws text (coin numbers, names) on canvas, so the font must be ready first.
const fontReady = document.fonts?.load('20px "Lilita One"').catch(() => undefined) ?? Promise.resolve();
void Promise.race([fontReady, new Promise((r) => setTimeout(r, 1500))]).then(() => {
  const [w, h] = size();
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: board,
    transparent: true,
    scale: { mode: Phaser.Scale.NONE, width: w, height: h, zoom: 1 / PX },
    render: { antialias: true, roundPixels: false, mipmapFilter: 'LINEAR_MIPMAP_LINEAR' },
    scene: [scene],
    banner: false,
    audio: { noAudio: true },
  });
  new ResizeObserver(() => {
    const [nw, nh] = size();
    if (nw === game.scale.width && nh === game.scale.height) return;
    game.scale.resize(nw, nh);
    game.scale.setZoom(1 / PX);
  }).observe(board);
});
