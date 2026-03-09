/**
 * Tracks which language servers are available for use.
 *
 * Research findings (Phase 4-T3):
 *
 * - **TypeScript/JavaScript**: Uses TypeScript's Language Service API directly
 *   (JavaScript-based, no WASM needed). Fully functional.
 *
 * - **Go (gopls)**: No WASM build exists. gopls is a native Go binary
 *   designed for LSP-over-stdio. Compiling to WASM is non-trivial due
 *   to Go runtime size and system dependencies. Not available for browser use.
 *
 * - **Rust (rust-analyzer)**: Experimental WASM build exists at
 *   github.com/rust-analyzer/rust-analyzer-wasm. Large binary (~10MB+).
 *   Could be integrated in a future phase.
 *
 * - **Python (Pyright)**: Pyright is TypeScript-based and can run in a
 *   Web Worker. Projects like monaco-pyright-lsp demonstrate browser use.
 *   Could be integrated in a future phase by adding pyright as a dependency.
 */

import type { SupportedLanguage } from '../shared/types';

/**
 * Languages that have a working server implementation available.
 * Other languages in the SupportedLanguage union are declared in
 * capabilities but not yet loadable.
 */
const AVAILABLE_SERVERS: ReadonlySet<SupportedLanguage> = new Set([
  'typescript',
  'javascript',
  'elixir',
]);

/**
 * Returns true if a working language server is available for the language.
 * The LspRouter should check this before attempting to spawn a worker.
 */
export function isServerAvailable(language: SupportedLanguage): boolean {
  return AVAILABLE_SERVERS.has(language);
}

/**
 * Maps a language to its Web Worker entry point URL.
 * Returns null for languages without an available server.
 *
 * The returned path is relative to the extension root and matches
 * the Vite build output for each worker entry point.
 */
export function getWorkerUrl(language: SupportedLanguage): string | null {
  switch (language) {
    case 'typescript':
    case 'javascript':
      return 'workers/ts-worker.js';
    case 'elixir':
      return 'workers/elixir-worker.js';
    case 'go':
    case 'rust':
    case 'python':
      return null;
    default:
      return null;
  }
}

/**
 * Returns a human-readable reason why a language server is not available.
 */
export function getUnavailableReason(language: SupportedLanguage): string {
  switch (language) {
    case 'go':
      return 'Go language server (gopls) is not yet available as a WASM binary for browser use.';
    case 'rust':
      return 'Rust language server (rust-analyzer) WASM build is experimental and not yet integrated.';
    case 'python':
      return 'Python language server (Pyright) integration is planned for a future release.';
    default:
      return `Language server for ${language} is not available.`;
  }
}
