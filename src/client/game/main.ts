/** Expanded game entry (game.html): Phaser board + DOM overlay. */
import * as Phaser from 'phaser';
import { context } from '@devvit/web/client';
import { BoardScene } from './scenes/BoardScene';
import { GameApp } from './app';
import './game.css';

const qs = new URLSearchParams(location.search);
const theme = qs.get('theme');
if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;

const root = document.getElementById('app')!;
const scene = new BoardScene();
const postId = context.postId ?? qs.get('postId') ?? undefined;
const app = new GameApp(root, scene, postId);
scene.onReady = () => {
  app.start().catch((e: unknown) => {
    root.textContent = `Something went wrong loading the machine. ${String(e)}`;
  });
};
new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'board',
  transparent: true,
  scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
  scene: [scene],
  banner: false,
  audio: { noAudio: true },
});
