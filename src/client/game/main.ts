/** Expanded game entry (game.html). */
import { context, navigateTo } from '@devvit/web/client';
import { Game } from '../pour/game';
import '../pour/game.css';

const qs = new URLSearchParams(location.search);
const root = document.getElementById('app')!;
const postId = context.postId ?? qs.get('postId') ?? undefined;
new Game(root, postId, { navigateTo: (url) => navigateTo(url) })
  .start()
  .catch((e: unknown) => {
    root.textContent = `Something went wrong loading the machine. ${String(e)}`;
  });
