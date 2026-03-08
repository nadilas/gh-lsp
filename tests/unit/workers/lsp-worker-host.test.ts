import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LspWorkerHost } from '../../../src/workers/lsp-worker-host';
import { VirtualFileSystem } from '../../../src/workers/vfs';
import type { WasmServer, WasmServerFactory } from '../../../src/workers/language-registry';
import {
  createJsonRpcRequest,
  createJsonRpcNotification,
} from '../../../src/workers/lsp-worker';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createMockServer(): WasmServer {
  return {
    initialize: vi.fn(async () => ({
      capabilities: {
        hoverProvider: true,
        definitionProvider: true,
        signatureHelpProvider: true,
      },
    })),
    handleRequest: vi.fn(async (_method: string, _params: unknown) => null),
    handleNotification: vi.fn(),
    shutdown: vi.fn(async () => undefined),
  };
}

function createMockFactory(server: WasmServer): WasmServerFactory {
  return vi.fn(async () => server);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('LspWorkerHost', () => {
  let vfs: VirtualFileSystem;
  let server: WasmServer;
  let factory: WasmServerFactory;
  let postMessage: ReturnType<typeof vi.fn>;
  let host: LspWorkerHost;

  beforeEach(() => {
    vfs = new VirtualFileSystem();
    server = createMockServer();
    factory = createMockFactory(server);
    postMessage = vi.fn();
    host = new LspWorkerHost(factory, vfs, postMessage);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initialize', () => {
    it('creates server via factory and initializes it', async () => {
      await host.handleMessage(
        createJsonRpcRequest(1, 'initialize', {
          processId: null,
          rootUri: null,
          capabilities: {},
        }),
      );

      expect(factory).toHaveBeenCalledWith(vfs);
      expect(server.initialize).toHaveBeenCalled();
    });

    it('sends success response with capabilities', async () => {
      await host.handleMessage(
        createJsonRpcRequest(1, 'initialize', {}),
      );

      expect(postMessage).toHaveBeenCalledTimes(1);
      const response = postMessage.mock.calls[0]![0] as {
        jsonrpc: string;
        id: number;
        result: { capabilities: { hoverProvider: boolean } };
      };
      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe(1);
      expect(response.result.capabilities.hoverProvider).toBe(true);
    });

    it('sets isInitialized to true', async () => {
      expect(host.isInitialized).toBe(false);

      await host.handleMessage(
        createJsonRpcRequest(1, 'initialize', {}),
      );

      expect(host.isInitialized).toBe(true);
    });
  });

  describe('shutdown', () => {
    it('calls server.shutdown()', async () => {
      await host.handleMessage(createJsonRpcRequest(1, 'initialize', {}));
      postMessage.mockClear();

      await host.handleMessage(createJsonRpcRequest(2, 'shutdown', null));

      expect(server.shutdown).toHaveBeenCalled();
    });

    it('sends success response with null result', async () => {
      await host.handleMessage(createJsonRpcRequest(1, 'initialize', {}));
      postMessage.mockClear();

      await host.handleMessage(createJsonRpcRequest(2, 'shutdown', null));

      const response = postMessage.mock.calls[0]![0] as {
        jsonrpc: string;
        id: number;
        result: null;
      };
      expect(response.result).toBeNull();
    });

    it('sets isInitialized to false', async () => {
      await host.handleMessage(createJsonRpcRequest(1, 'initialize', {}));
      expect(host.isInitialized).toBe(true);

      await host.handleMessage(createJsonRpcRequest(2, 'shutdown', null));
      expect(host.isInitialized).toBe(false);
    });

    it('handles shutdown without prior initialize', async () => {
      await host.handleMessage(createJsonRpcRequest(1, 'shutdown', null));

      const response = postMessage.mock.calls[0]![0] as {
        jsonrpc: string;
        id: number;
        result: null;
      };
      expect(response.result).toBeNull();
    });
  });

  describe('LSP requests (hover, definition, signatureHelp)', () => {
    beforeEach(async () => {
      await host.handleMessage(createJsonRpcRequest(1, 'initialize', {}));
      postMessage.mockClear();
    });

    it('routes textDocument/hover to server.handleRequest', async () => {
      const params = {
        textDocument: { uri: 'file:///test.ts' },
        position: { line: 0, character: 5 },
      };

      await host.handleMessage(
        createJsonRpcRequest(2, 'textDocument/hover', params),
      );

      expect(server.handleRequest).toHaveBeenCalledWith(
        'textDocument/hover',
        params,
      );
    });

    it('routes textDocument/definition to server.handleRequest', async () => {
      const params = {
        textDocument: { uri: 'file:///test.ts' },
        position: { line: 0, character: 5 },
      };

      await host.handleMessage(
        createJsonRpcRequest(3, 'textDocument/definition', params),
      );

      expect(server.handleRequest).toHaveBeenCalledWith(
        'textDocument/definition',
        params,
      );
    });

    it('routes textDocument/signatureHelp to server.handleRequest', async () => {
      const params = {
        textDocument: { uri: 'file:///test.ts' },
        position: { line: 0, character: 5 },
      };

      await host.handleMessage(
        createJsonRpcRequest(4, 'textDocument/signatureHelp', params),
      );

      expect(server.handleRequest).toHaveBeenCalledWith(
        'textDocument/signatureHelp',
        params,
      );
    });

    it('sends success response with server result', async () => {
      const hoverResult = {
        contents: { kind: 'markdown', value: '```ts\nconst x: number\n```' },
      };
      (server.handleRequest as ReturnType<typeof vi.fn>).mockResolvedValue(
        hoverResult,
      );

      await host.handleMessage(
        createJsonRpcRequest(2, 'textDocument/hover', {
          textDocument: { uri: 'file:///test.ts' },
          position: { line: 0, character: 5 },
        }),
      );

      const response = postMessage.mock.calls[0]![0] as {
        jsonrpc: string;
        id: number;
        result: unknown;
      };
      expect(response.id).toBe(2);
      expect(response.result).toEqual(hoverResult);
    });

    it('sends null result when server returns null', async () => {
      (server.handleRequest as ReturnType<typeof vi.fn>).mockResolvedValue(
        null,
      );

      await host.handleMessage(
        createJsonRpcRequest(2, 'textDocument/hover', {
          textDocument: { uri: 'file:///test.ts' },
          position: { line: 0, character: 5 },
        }),
      );

      const response = postMessage.mock.calls[0]![0] as {
        jsonrpc: string;
        id: number;
        result: null;
      };
      expect(response.result).toBeNull();
    });
  });

  describe('requests before initialization', () => {
    it('returns ServerNotInitialized error', async () => {
      await host.handleMessage(
        createJsonRpcRequest(1, 'textDocument/hover', {
          textDocument: { uri: 'file:///test.ts' },
          position: { line: 0, character: 0 },
        }),
      );

      const response = postMessage.mock.calls[0]![0] as {
        jsonrpc: string;
        id: number;
        error: { code: number; message: string };
      };
      expect(response.error).toBeDefined();
      expect(response.error.code).toBe(-32002); // ServerNotInitialized
      expect(response.error.message).toBe('Server not initialized');
    });
  });

  describe('request error handling', () => {
    beforeEach(async () => {
      await host.handleMessage(createJsonRpcRequest(1, 'initialize', {}));
      postMessage.mockClear();
    });

    it('sends InternalError when server.handleRequest throws', async () => {
      (server.handleRequest as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Unexpected failure'),
      );

      await host.handleMessage(
        createJsonRpcRequest(2, 'textDocument/hover', {
          textDocument: { uri: 'file:///test.ts' },
          position: { line: 0, character: 0 },
        }),
      );

      const response = postMessage.mock.calls[0]![0] as {
        jsonrpc: string;
        id: number;
        error: { code: number; message: string };
      };
      expect(response.error.code).toBe(-32603); // InternalError
      expect(response.error.message).toBe('Unexpected failure');
    });

    it('sends InternalError when initialize fails', async () => {
      // Create a new host with a failing factory
      const failFactory: WasmServerFactory = vi.fn(async () => {
        throw new Error('WASM load failed');
      });
      const failHost = new LspWorkerHost(failFactory, vfs, postMessage);

      await failHost.handleMessage(
        createJsonRpcRequest(1, 'initialize', {}),
      );

      const response = postMessage.mock.calls[0]![0] as {
        jsonrpc: string;
        id: number;
        error: { code: number; message: string };
      };
      expect(response.error.code).toBe(-32603);
      expect(response.error.message).toBe('WASM load failed');
    });
  });

  describe('notifications', () => {
    beforeEach(async () => {
      await host.handleMessage(createJsonRpcRequest(1, 'initialize', {}));
      postMessage.mockClear();
    });

    it('routes textDocument/didOpen to server.handleNotification', async () => {
      const params = {
        textDocument: {
          uri: 'file:///test.ts',
          languageId: 'typescript',
          version: 1,
          text: 'const x = 1;',
        },
      };

      await host.handleMessage(
        createJsonRpcNotification('textDocument/didOpen', params),
      );

      expect(server.handleNotification).toHaveBeenCalledWith(
        'textDocument/didOpen',
        params,
      );
    });

    it('handles initialized notification without error', async () => {
      await host.handleMessage(
        createJsonRpcNotification('initialized', {}),
      );

      // Should not call server.handleNotification
      expect(server.handleNotification).not.toHaveBeenCalled();
      // Should not send any response
      expect(postMessage).not.toHaveBeenCalled();
    });

    it('does not forward notifications when server is not initialized', async () => {
      const uninitHost = new LspWorkerHost(factory, vfs, postMessage);

      await uninitHost.handleMessage(
        createJsonRpcNotification('textDocument/didOpen', {
          textDocument: {
            uri: 'file:///test.ts',
            languageId: 'typescript',
            version: 1,
            text: 'const x = 1;',
          },
        }),
      );

      expect(server.handleNotification).not.toHaveBeenCalled();
    });

    it('does not send response for notifications', async () => {
      await host.handleMessage(
        createJsonRpcNotification('textDocument/didOpen', {
          textDocument: {
            uri: 'file:///test.ts',
            languageId: 'typescript',
            version: 1,
            text: 'const x = 1;',
          },
        }),
      );

      expect(postMessage).not.toHaveBeenCalled();
    });
  });

  describe('invalid messages', () => {
    it('ignores non-object messages', async () => {
      await host.handleMessage('not an object');
      await host.handleMessage(42);
      await host.handleMessage(null);

      expect(postMessage).not.toHaveBeenCalled();
    });

    it('ignores messages without jsonrpc field', async () => {
      await host.handleMessage({ id: 1, method: 'test' });

      expect(postMessage).not.toHaveBeenCalled();
    });

    it('ignores response messages', async () => {
      // A response has `id` + `result` but no `method`
      await host.handleMessage({
        jsonrpc: '2.0',
        id: 1,
        result: null,
      });

      expect(postMessage).not.toHaveBeenCalled();
    });
  });

  describe('full LSP lifecycle', () => {
    it('supports initialize → didOpen → hover → shutdown flow', async () => {
      // Initialize
      await host.handleMessage(createJsonRpcRequest(1, 'initialize', {}));
      expect(host.isInitialized).toBe(true);

      // initialized notification
      await host.handleMessage(
        createJsonRpcNotification('initialized', {}),
      );

      // didOpen
      await host.handleMessage(
        createJsonRpcNotification('textDocument/didOpen', {
          textDocument: {
            uri: 'file:///test.ts',
            languageId: 'typescript',
            version: 1,
            text: 'const x = 42;',
          },
        }),
      );

      expect(server.handleNotification).toHaveBeenCalledWith(
        'textDocument/didOpen',
        expect.anything(),
      );

      // hover
      (server.handleRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
        contents: { kind: 'markdown', value: '```ts\nconst x: number\n```' },
      });

      await host.handleMessage(
        createJsonRpcRequest(2, 'textDocument/hover', {
          textDocument: { uri: 'file:///test.ts' },
          position: { line: 0, character: 6 },
        }),
      );

      expect(server.handleRequest).toHaveBeenCalledWith(
        'textDocument/hover',
        expect.anything(),
      );

      // shutdown
      postMessage.mockClear();
      await host.handleMessage(createJsonRpcRequest(3, 'shutdown', null));
      expect(host.isInitialized).toBe(false);
    });
  });
});
