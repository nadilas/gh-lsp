import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { crx } from '@crxjs/vite-plugin';
import { resolve } from 'path';
import manifest from './src/manifest.json';

export default defineConfig({
  // Root must be 'src' so @crxjs/vite-plugin resolves manifest paths
  // (content/index.ts, background/index.ts, etc.) relative to src/
  root: 'src',
  plugins: [
    preact(),
    crx({ manifest }),
  ],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@content': resolve(__dirname, 'src/content'),
      '@background': resolve(__dirname, 'src/background'),
      '@workers': resolve(__dirname, 'src/workers'),
      '@ui': resolve(__dirname, 'src/ui'),
    },
  },
  build: {
    // outDir is relative to the new root (src/), so go up one level
    outDir: '../dist/chrome',
    sourcemap: true,
    // No explicit rollupOptions.input needed — @crxjs picks up HTML pages
    // from the manifest (default_popup, options_page) automatically.
  },
  test: {
    // Override test root back to project root so test paths resolve correctly
    root: resolve(__dirname),
    globals: true,
    environment: 'jsdom',
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts', 'src/manifest.json'],
    },
  },
});
