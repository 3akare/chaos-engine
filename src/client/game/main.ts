/** Expanded game entry (game.html): Phaser board + DOM controls. */
import * as Phaser from 'phaser';
import { context } from '@devvit/web/client';
import { BoardScene } from './scenes/BoardScene';
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

// The board draws text (coin numbers, names) on canvas, so the font must be ready first.
const fontReady = document.fonts?.load('20px "Lilita One"').catch(() => undefined) ?? Promise.resolve();
void Promise.race([fontReady, new Promise((r) => setTimeout(r, 1500))]).then(() => {
  new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'board',
    transparent: true,
    scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
    render: { antialias: true, roundPixels: false },
    scene: [scene],
    banner: false,
    audio: { noAudio: true },
  });
});
