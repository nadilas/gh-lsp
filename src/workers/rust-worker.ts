/**
 * Web Worker entry point for Rust language support.
 *
 * Loaded by the WorkerPool when a Rust file is opened.
 * Routes JSON-RPC messages between the background service worker and the
 * Rust syntax analysis server.
 */

import { LspWorkerHost } from './lsp-worker-host';
import { createRustServer } from './servers/rust-server';
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

const host = new LspWorkerHost(
  createRustServer,
  vfs,
  self.postMessage.bind(self),
);

self.onmessage = (event: MessageEvent) => {
  void host.handleMessage(event.data);
};
