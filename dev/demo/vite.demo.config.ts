import { defineConfig } from 'vite';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');

/** Browser playtest bundle: one JS + one CSS file, published as an Artifact. */
export default defineConfig({
  root,
  base: './',
  publicDir: false,
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  resolve: { alias: { '@devvit/web/client': path.join(root, 'dev/demo/devvit-client.ts') } },
  build: {
    outDir: path.join(root, 'dist/demo'),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    minify: true,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 4000,
    cssCodeSplit: false,
    lib: { entry: path.join(root, 'dev/demo/main.ts'), formats: ['es'], fileName: () => 'demo.js', cssFileName: 'demo' },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
