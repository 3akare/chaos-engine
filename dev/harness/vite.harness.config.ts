import { defineConfig } from 'vite';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');

export default defineConfig({
  root,
  base: '/',
  publicDir: path.join(root, 'public'),
  resolve: {
    alias: { '@devvit/web/client': path.join(root, 'dev/harness/fake-devvit-client.ts') },
  },
  build: {
    outDir: path.join(root, 'dist/harness'),
    emptyOutDir: true,
    sourcemap: true,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        splash: path.join(root, 'src/client/splash.html'),
        game: path.join(root, 'src/client/game.html'),
        shell: path.join(root, 'dev/harness/shell/index.html'),
        gallery: path.join(root, 'dev/harness/shell/gallery.html'),
      },
    },
  },
});
