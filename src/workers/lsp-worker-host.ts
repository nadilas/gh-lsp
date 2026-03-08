/**
 * Generic LSP worker host that bridges JSON-RPC messages to a WasmServer.
 *
 * Reusable across all language workers — receives JSON-RPC requests/notifications
 * via handleMessage(), routes them to the WasmServer, and sends JSON-RPC
 * responses back via the provided postMessage callback.
 */

import type { JsonRpcRequest, JsonRpcNotification } from '../shared/types';
import { LspErrorCode } from '../shared/types';
import type { WasmServer, WasmServerFactory } from './language-registry';
import type { VirtualFileSystem } from './vfs';
import {
  isJsonRpcRequest,
  isJsonRpcNotification,
  createJsonRpcSuccessResponse,
  createJsonRpcErrorResponse,
} from './lsp-worker';

export class LspWorkerHost {
  private server: WasmServer | null = null;
  private readonly serverFactory: WasmServerFactory;
  private readonly vfs: VirtualFileSystem;
  private readonly send: (msg: unknown) => void;

  constructor(
    serverFactory: WasmServerFactory,
    vfs: VirtualFileSystem,
    postMessage: (msg: unknown) => void,
  ) {
    this.serverFactory = serverFactory;
    this.vfs = vfs;
    this.send = postMessage;
  }

  /**
   * Processes an incoming message from the background service worker.
   * Dispatches to the appropriate handler based on message type.
   */
  async handleMessage(data: unknown): Promise<void> {
    if (isJsonRpcRequest(data)) {
      await this.handleRequest(data);
    } else if (isJsonRpcNotification(data)) {
      this.handleNotification(data);
    }
  }

  /**
   * Returns whether the server has been initialized.
   */
  get isInitialized(): boolean {
    return this.server !== null;
  }

  private async handleRequest(request: JsonRpcRequest): Promise<void> {
    try {
      switch (request.method) {
        case 'initialize':
          await this.handleInitialize(request);
          break;

        case 'shutdown':
          await this.handleShutdown(request);
          break;

        default:
          await this.handleLspRequest(request);
          break;
      }
    } catch (error) {
      this.send(
        createJsonRpcErrorResponse(
          request.id,
          LspErrorCode.InternalError,
          error instanceof Error ? error.message : 'Internal error',
        ),
      );
    }
  }

  private async handleInitialize(request: JsonRpcRequest): Promise<void> {
    this.server = await this.serverFactory(this.vfs);
    const result = await this.server.initialize(request.params);
    this.send(createJsonRpcSuccessResponse(request.id, result));
  }

  private async handleShutdown(request: JsonRpcRequest): Promise<void> {
    if (this.server) {
      await this.server.shutdown();
      this.server = null;
    }
    this.send(createJsonRpcSuccessResponse(request.id, null));
  }

  private async handleLspRequest(request: JsonRpcRequest): Promise<void> {
    if (!this.server) {
      this.send(
        createJsonRpcErrorResponse(
          request.id,
          LspErrorCode.ServerNotInitialized,
          'Server not initialized',
        ),
      );
      return;
    }

    const result = await this.server.handleRequest(
      request.method,
      request.params,
    );
    this.send(createJsonRpcSuccessResponse(request.id, result));
  }

  private handleNotification(notification: JsonRpcNotification): void {
    // LSP lifecycle notifications
    if (notification.method === 'initialized') {
      return;
    }

    if (notification.method === 'exit') {
      if (typeof self !== 'undefined' && typeof self.close === 'function') {
        self.close();
      }
      return;
    }

    // Forward to server
    if (this.server) {
      this.server.handleNotification(
        notification.method,
        notification.params,
      );
    }
  }
}
