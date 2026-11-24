import { defineConfig } from 'vite';
export default defineConfig({ root: 'dev/pour/gallery', base: './', build: { outDir: '../../../dist/gallery', emptyOutDir: true } });
