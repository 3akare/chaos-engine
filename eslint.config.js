import { defineConfig } from 'eslint/config';
import globals from 'globals';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const project = (p) => ({
  parserOptions: { project: [p], tsconfigRootDir: import.meta.dirname },
});

export default defineConfig([
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'eslint.config.js',
      'vite.config.ts',
      'vitest.config.ts',
      'dev/pour/gallery/vite.config.ts',
      'dev/demo/vite.demo.config.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/server/**/*.ts'],
    languageOptions: { ecmaVersion: 2023, globals: globals.node, ...project('./tools/tsconfig.server.json') },
  },
  {
    files: ['src/client/**/*.ts'],
    languageOptions: { ecmaVersion: 2023, globals: globals.browser, ...project('./tools/tsconfig.client.json') },
  },
  {
    files: ['src/shared/**/*.ts'],
    languageOptions: { ecmaVersion: 2023, globals: {}, ...project('./tools/tsconfig.shared.json') },
    rules: {
      // src/shared must stay pure and deterministic (plan §11.2).
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'src/shared is pure: pass time in explicitly.' },
        { name: 'window', message: 'src/shared is platform-free.' },
        { name: 'document', message: 'src/shared is platform-free.' },
        { name: 'fetch', message: 'src/shared is platform-free.' },
        { name: 'crypto', message: 'src/shared is platform-free.' },
        { name: 'performance', message: 'src/shared is pure.' },
        { name: 'setTimeout', message: 'src/shared is pure.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the seeded rng from src/shared/rng.ts.' },
        { object: 'Date', property: 'now', message: 'src/shared is pure: pass time in explicitly.' },
      ],
    },
  },
  {
    files: ['tests/**/*.ts', 'dev/**/*.ts'],
    languageOptions: { ecmaVersion: 2023, globals: globals.node, ...project('./tools/tsconfig.dev.json') },
  },
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-unused-vars': 'off',
    },
  },
]);
