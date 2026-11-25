/** Expanded game entry (game.html). Opens in the mode picked on the post (Personal or Group). */
import { context, navigateTo } from '@devvit/web/client';
import { Game } from '../pour/game';
import { store } from '../pour/dom';
import '../pour/game.css';

const qs = new URLSearchParams(location.search);
const root = document.getElementById('app')!;
const postId = context.postId ?? qs.get('postId') ?? undefined;
const mode = (qs.get('mode') ?? store('ce_mode')) === 'personal' ? 'personal' : 'group';
new Game(root, postId, { navigateTo: (url) => navigateTo(url) }, mode)
  .start()
  .catch((e: unknown) => {
    root.textContent = `Something went wrong loading the machine. ${String(e)}`;
  });
