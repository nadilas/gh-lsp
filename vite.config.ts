import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { crx } from '@crxjs/vite-plugin';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync } from 'fs';
import manifest from './src/manifest.json';

/**
 * Copies tree-sitter WASM files from node_modules into the build output
 * so the Go language server Web Worker can load them at runtime.
 */
function copyTreeSitterWasm(): Plugin {
  return {
    name: 'copy-tree-sitter-wasm',
    writeBundle(options) {
      const outDir = options.dir || resolve(__dirname, 'dist/chrome');
      const wasmDir = resolve(outDir, 'lsp/wasm');
      if (!existsSync(wasmDir)) {
        mkdirSync(wasmDir, { recursive: true });
      }
      copyFileSync(
        resolve(__dirname, 'node_modules/web-tree-sitter/web-tree-sitter.wasm'),
        resolve(wasmDir, 'tree-sitter.wasm'),
      );
      copyFileSync(
        resolve(__dirname, 'node_modules/tree-sitter-go/tree-sitter-go.wasm'),
        resolve(wasmDir, 'tree-sitter-go.wasm'),
      );
    },
  };
}

export default defineConfig({
  // Root must be 'src' so @crxjs/vite-plugin resolves manifest paths
  // (content/index.ts, background/index.ts, etc.) relative to src/
  root: 'src',
  plugins: [
    preact(),
    crx({ manifest }),
    copyTreeSitterWasm(),
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
