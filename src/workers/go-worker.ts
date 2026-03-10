/**
 * Web Worker entry point for Go language support.
 *
 * Loaded by the WorkerPool when a Go file is opened.
 * Routes JSON-RPC messages between the background service worker and the
 * tree-sitter-based Go language server adapter.
 */

import { LspWorkerHost } from './lsp-worker-host';
import { createGoServer } from './servers/go-server';
import { VirtualFileSystem } from './vfs';

declare const self: DedicatedWorkerGlobalScope;

const vfs = new VirtualFileSystem((uri) => {
  // When the language server requests a file not in the VFS,
  // ask the background to fetch and send it via textDocument/didOpen.
  self.postMessage({
    type: 'gh-lsp/requestFile',
    payload: { uri },
  });
});

// Resolve WASM path relative to the extension root.
// The worker URL is workers/go-worker.js, so go up one level.
const extensionRoot = new URL('..', self.location.href).href;
const goGrammarWasmUrl = new URL(
  'lsp/wasm/tree-sitter-go.wasm',
  extensionRoot,
).href;

const host = new LspWorkerHost(
  (vfsInstance) => createGoServer(vfsInstance, { goGrammarWasmUrl }),
  vfs,
  self.postMessage.bind(self),
);

self.onmessage = (event: MessageEvent) => {
  void host.handleMessage(event.data);
};
