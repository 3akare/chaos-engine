import { defineConfig } from 'vite';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');

/** The brand page: draws the subreddit icon and banners with the game's own art. */
export default defineConfig({
  root: path.join(root, 'dev/brand'),
  base: './',
  publicDir: false,
  build: { outDir: path.join(root, 'dist/brand'), emptyOutDir: true, target: 'es2022', assetsInlineLimit: 100_000_000 },
});
