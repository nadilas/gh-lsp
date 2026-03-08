import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  JsonRpcTransport,
  isJsonRpcRequest,
  isJsonRpcNotification,
  isJsonRpcResponse,
  createJsonRpcRequest,
  createJsonRpcNotification,
  createJsonRpcSuccessResponse,
  createJsonRpcErrorResponse,
} from '../../../src/workers/lsp-worker';
import { LspErrorCode } from '../../../src/shared/types';

// Swallow expected rejections from fire-and-forget sendRequest calls
function ignoreRejection(promise: Promise<unknown>): void {
  promise.catch(() => {});
}

describe('JsonRpcTransport', () => {
  let transport: JsonRpcTransport;
  let postMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    postMessage = vi.fn();
    transport = new JsonRpcTransport(postMessage, 5_000);
  });

  afterEach(() => {
    transport.dispose();
    vi.useRealTimers();
  });

  describe('sendRequest', () => {
    it('sends a JSON-RPC request via postMessage', () => {
      ignoreRejection(transport.sendRequest('textDocument/hover', { uri: 'file.ts' }));

      expect(postMessage).toHaveBeenCalledWith({
        jsonrpc: '2.0',
        id: 1,
        method: 'textDocument/hover',
        params: { uri: 'file.ts' },
      });
    });

    it('assigns incrementing IDs to requests', () => {
      ignoreRejection(transport.sendRequest('method1'));
      ignoreRejection(transport.sendRequest('method2'));
      ignoreRejection(transport.sendRequest('method3'));

      expect(postMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: 1 }));
      expect(postMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: 2 }));
      expect(postMessage).toHaveBeenNthCalledWith(3, expect.objectContaining({ id: 3 }));
    });

    it('resolves when matching response arrives', async () => {
      const promise = transport.sendRequest<{ contents: string }>('textDocument/hover');

      transport.handleMessage({
        jsonrpc: '2.0',
        id: 1,
        result: { contents: 'string type' },
      });

      const result = await promise;
      expect(result).toEqual({ contents: 'string type' });
    });

    it('rejects when error response arrives', async () => {
      const promise = transport.sendRequest('textDocument/hover');

      transport.handleMessage({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32601, message: 'Method not found' },
      });

      await expect(promise).rejects.toMatchObject({
        code: -32601,
        message: 'Method not found',
      });
    });

    it('rejects on timeout', async () => {
      const promise = transport.sendRequest('textDocument/hover', undefined, 1_000);

      vi.advanceTimersByTime(1_001);

      await expect(promise).rejects.toMatchObject({
        code: LspErrorCode.RequestCancelled,
      });
    });

    it('tracks pending requests', () => {
      ignoreRejection(transport.sendRequest('method1'));
      ignoreRejection(transport.sendRequest('method2'));

      expect(transport.pendingCount).toBe(2);
    });

    it('removes pending entry after response', async () => {
      const promise = transport.sendRequest('method1');

      transport.handleMessage({ jsonrpc: '2.0', id: 1, result: null });
      await promise;

      expect(transport.pendingCount).toBe(0);
    });
  });

  describe('sendNotification', () => {
    it('sends a notification without an id', () => {
      transport.sendNotification('initialized', {});

      expect(postMessage).toHaveBeenCalledWith({
        jsonrpc: '2.0',
        method: 'initialized',
        params: {},
      });
    });

    it('does not create a pending entry', () => {
      transport.sendNotification('initialized');

      expect(transport.pendingCount).toBe(0);
    });

    it('omits params when not provided', () => {
      transport.sendNotification('shutdown');

      expect(postMessage).toHaveBeenCalledWith({
        jsonrpc: '2.0',
        method: 'shutdown',
      });
    });
  });

  describe('handleMessage', () => {
    it('correlates response to correct pending request', async () => {
      const promise1 = transport.sendRequest<string>('method1');
      const promise2 = transport.sendRequest<string>('method2');

      transport.handleMessage({ jsonrpc: '2.0', id: 2, result: 'response2' });
      transport.handleMessage({ jsonrpc: '2.0', id: 1, result: 'response1' });

      expect(await promise1).toBe('response1');
      expect(await promise2).toBe('response2');
    });

    it('ignores messages without an id', () => {
      ignoreRejection(transport.sendRequest('method1'));

      transport.handleMessage({ jsonrpc: '2.0', method: 'notification' });

      expect(transport.pendingCount).toBe(1);
    });

    it('ignores messages with unknown id', () => {
      ignoreRejection(transport.sendRequest('method1'));

      transport.handleMessage({ jsonrpc: '2.0', id: 999, result: 'unknown' });

      expect(transport.pendingCount).toBe(1);
    });

    it('ignores null/undefined/non-object messages', () => {
      transport.handleMessage(null);
      transport.handleMessage(undefined);
      transport.handleMessage('string');
      transport.handleMessage(42);
    });
  });

  describe('cancelRequest', () => {
    it('sends $/cancelRequest notification', async () => {
      const promise = transport.sendRequest('method1');
      postMessage.mockClear();

      transport.cancelRequest(1);

      expect(postMessage).toHaveBeenCalledWith({
        jsonrpc: '2.0',
        method: '$/cancelRequest',
        params: { id: 1 },
      });

      await expect(promise).rejects.toBeDefined();
    });

    it('rejects the pending promise with RequestCancelled', async () => {
      const promise = transport.sendRequest('method1');

      transport.cancelRequest(1);

      await expect(promise).rejects.toMatchObject({
        code: LspErrorCode.RequestCancelled,
      });
    });

    it('removes the pending entry', async () => {
      const promise = transport.sendRequest('method1');
      expect(transport.pendingCount).toBe(1);

      transport.cancelRequest(1);

      expect(transport.pendingCount).toBe(0);
      await promise.catch(() => {});
    });

    it('does nothing for unknown id', () => {
      transport.cancelRequest(999);
      expect(postMessage).not.toHaveBeenCalled();
    });
  });

  describe('dispose', () => {
    it('rejects all pending requests', async () => {
      const promise1 = transport.sendRequest('method1');
      const promise2 = transport.sendRequest('method2');

      transport.dispose();

      await expect(promise1).rejects.toMatchObject({
        code: LspErrorCode.RequestCancelled,
      });
      await expect(promise2).rejects.toMatchObject({
        code: LspErrorCode.RequestCancelled,
      });
    });

    it('clears all pending entries', async () => {
      const p1 = transport.sendRequest('method1');
      const p2 = transport.sendRequest('method2');

      transport.dispose();

      expect(transport.pendingCount).toBe(0);
      await p1.catch(() => {});
      await p2.catch(() => {});
    });
  });
});

describe('type guards', () => {
  describe('isJsonRpcRequest', () => {
    it('identifies valid requests', () => {
      expect(isJsonRpcRequest({ jsonrpc: '2.0', id: 1, method: 'hover' })).toBe(true);
      expect(isJsonRpcRequest({ jsonrpc: '2.0', id: 'abc', method: 'hover', params: {} })).toBe(true);
    });

    it('rejects non-requests', () => {
      expect(isJsonRpcRequest(null)).toBe(false);
      expect(isJsonRpcRequest({})).toBe(false);
      expect(isJsonRpcRequest({ jsonrpc: '2.0', method: 'hover' })).toBe(false);
      expect(isJsonRpcRequest({ jsonrpc: '2.0', id: 1, result: {} })).toBe(false);
      expect(isJsonRpcRequest({ jsonrpc: '1.0', id: 1, method: 'hover' })).toBe(false);
    });
  });

  describe('isJsonRpcNotification', () => {
    it('identifies valid notifications', () => {
      expect(isJsonRpcNotification({ jsonrpc: '2.0', method: 'initialized' })).toBe(true);
      expect(isJsonRpcNotification({ jsonrpc: '2.0', method: 'exit', params: {} })).toBe(true);
    });

    it('rejects non-notifications', () => {
      expect(isJsonRpcNotification(null)).toBe(false);
      expect(isJsonRpcNotification({ jsonrpc: '2.0', id: 1, method: 'hover' })).toBe(false);
      expect(isJsonRpcNotification({ jsonrpc: '2.0', result: {} })).toBe(false);
    });
  });

  describe('isJsonRpcResponse', () => {
    it('identifies success responses', () => {
      expect(isJsonRpcResponse({ jsonrpc: '2.0', id: 1, result: {} })).toBe(true);
      expect(isJsonRpcResponse({ jsonrpc: '2.0', id: 1, result: null })).toBe(true);
    });

    it('identifies error responses', () => {
      expect(isJsonRpcResponse({ jsonrpc: '2.0', id: 1, error: { code: -32600, message: 'err' } })).toBe(true);
    });

    it('rejects non-responses', () => {
      expect(isJsonRpcResponse(null)).toBe(false);
      expect(isJsonRpcResponse({ jsonrpc: '2.0', method: 'notification' })).toBe(false);
      expect(isJsonRpcResponse({ jsonrpc: '2.0', id: 1, method: 'request' })).toBe(false);
    });
  });
});

describe('factories', () => {
  describe('createJsonRpcRequest', () => {
    it('creates a valid request', () => {
      const req = createJsonRpcRequest(1, 'textDocument/hover', { uri: 'file.ts' });
      expect(req).toEqual({
        jsonrpc: '2.0',
        id: 1,
        method: 'textDocument/hover',
        params: { uri: 'file.ts' },
      });
      expect(isJsonRpcRequest(req)).toBe(true);
    });

    it('omits params when undefined', () => {
      const req = createJsonRpcRequest(1, 'shutdown');
      expect(req).toEqual({ jsonrpc: '2.0', id: 1, method: 'shutdown' });
      expect(req).not.toHaveProperty('params');
    });
  });

  describe('createJsonRpcNotification', () => {
    it('creates a valid notification', () => {
      const notif = createJsonRpcNotification('initialized', {});
      expect(notif).toEqual({ jsonrpc: '2.0', method: 'initialized', params: {} });
      expect(isJsonRpcNotification(notif)).toBe(true);
    });
  });

  describe('createJsonRpcSuccessResponse', () => {
    it('creates a valid success response', () => {
      const resp = createJsonRpcSuccessResponse(1, { contents: 'hover' });
      expect(resp).toEqual({
        jsonrpc: '2.0',
        id: 1,
        result: { contents: 'hover' },
      });
      expect(isJsonRpcResponse(resp)).toBe(true);
    });
  });

  describe('createJsonRpcErrorResponse', () => {
    it('creates a valid error response', () => {
      const resp = createJsonRpcErrorResponse(1, -32601, 'Method not found');
      expect(resp).toEqual({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32601, message: 'Method not found' },
      });
      expect(isJsonRpcResponse(resp)).toBe(true);
    });

    it('includes optional data', () => {
      const resp = createJsonRpcErrorResponse(1, -32600, 'Invalid', { detail: 'extra' });
      expect(resp.error.data).toEqual({ detail: 'extra' });
    });

    it('supports null id for parse errors', () => {
      const resp = createJsonRpcErrorResponse(null, -32700, 'Parse error');
      expect(resp.id).toBeNull();
    });
  });
});
