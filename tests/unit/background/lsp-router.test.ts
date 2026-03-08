import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LspRouter } from '../../../src/background/lsp-router';
import type { WorkerPool, ManagedWorker } from '../../../src/background/worker-pool';
import type { DocumentSync } from '../../../src/background/document-sync';
import { LruCache } from '../../../src/background/cache';
import type {
  ExtensionSettings,
  LspHoverRequest,
  LspDefinitionRequest,
  LspSignatureHelpRequest,
  LspCancelRequest,
  LspErrorResponse,
  LspHoverResponse,
  LspDefinitionResponse,
} from '../../../src/shared/types';
import { DEFAULT_SETTINGS } from '../../../src/shared/settings';
import { JsonRpcTransport } from '../../../src/workers/lsp-worker';

function createMockTransport(): JsonRpcTransport {
  const transport = new JsonRpcTransport(vi.fn(), 5000);
  vi.spyOn(transport, 'sendRequest').mockResolvedValue(null);
  vi.spyOn(transport, 'sendNotification').mockImplementation(() => {});
  return transport;
}

function createMockManagedWorker(
  language: string,
): ManagedWorker {
  return {
    id: `${language}-1`,
    language: language as ManagedWorker['language'],
    worker: {} as Worker,
    transport: createMockTransport(),
    status: 'ready',
    lastUsedAt: Date.now(),
    pendingRequests: new Set(),
  };
}

function createMockWorkerPool(): WorkerPool {
  const workers = new Map<string, ManagedWorker>();

  return {
    getOrCreateWorker: vi.fn(async (lang: string) => {
      let w = workers.get(lang);
      if (!w) {
        w = createMockManagedWorker(lang);
        workers.set(lang, w);
      }
      return w;
    }),
    terminateWorker: vi.fn(async () => undefined),
    terminateAll: vi.fn(async () => undefined),
    startIdleTimer: vi.fn(),
    getWorker: vi.fn((lang: string) => workers.get(lang)),
    setStatusCallback: vi.fn(),
    get activeCount() {
      return workers.size;
    },
  } as unknown as WorkerPool;
}

function createMockDocumentSync(): DocumentSync {
  return {
    ensureDocumentOpen: vi.fn(async () => undefined),
    handleFileRequest: vi.fn(async () => undefined),
    onWorkerTerminated: vi.fn(),
    getOpenDocuments: vi.fn(() => new Set<string>()),
  } as unknown as DocumentSync;
}

function createHoverRequest(overrides?: Partial<LspHoverRequest>): LspHoverRequest {
  return {
    type: 'lsp/hover',
    requestId: 'req-1',
    owner: 'owner',
    repo: 'repo',
    ref: 'main',
    filePath: 'src/index.ts',
    position: { line: 10, character: 5 },
    ...overrides,
  };
}

describe('LspRouter', () => {
  let router: LspRouter;
  let workerPool: WorkerPool;
  let docSync: DocumentSync;
  let cache: LruCache<unknown>;
  let settings: ExtensionSettings;

  beforeEach(() => {
    workerPool = createMockWorkerPool();
    docSync = createMockDocumentSync();
    cache = new LruCache<unknown>(100, 600_000);
    settings = { ...DEFAULT_SETTINGS };

    router = new LspRouter(workerPool, docSync, cache, async () => settings);
  });

  describe('handleRequest — hover', () => {
    it('routes hover request to correct language worker', async () => {
      const request = createHoverRequest();
      const result = await router.handleRequest(request);

      expect(workerPool.getOrCreateWorker).toHaveBeenCalledWith('typescript');
      expect(result.type).toBe('lsp/response');
      expect((result as LspHoverResponse).kind).toBe('hover');
    });

    it('ensures document is opened before sending request', async () => {
      const request = createHoverRequest();
      await router.handleRequest(request);

      expect(docSync.ensureDocumentOpen).toHaveBeenCalledWith(
        expect.stringContaining('typescript'),
        'owner',
        'repo',
        'main',
        'src/index.ts',
        expect.any(Function),
      );
    });

    it('sends textDocument/hover to the worker transport', async () => {
      const request = createHoverRequest();
      const managed = await workerPool.getOrCreateWorker('typescript');

      await router.handleRequest(request);

      expect(managed.transport.sendRequest).toHaveBeenCalledWith(
        'textDocument/hover',
        {
          textDocument: { uri: 'gh-lsp://owner/repo/main/src/index.ts' },
          position: { line: 10, character: 5 },
        },
      );
    });

    it('caches non-null hover results', async () => {
      const hoverResult = { contents: { kind: 'markdown' as const, value: '**string**' } };
      const managed = await workerPool.getOrCreateWorker('typescript');
      vi.spyOn(managed.transport, 'sendRequest').mockResolvedValue(hoverResult);

      await router.handleRequest(createHoverRequest());

      // Verify cache has the result
      const cacheKey = 'owner/repo/main/src/index.ts:10:5:lsp/hover';
      expect(cache.get(cacheKey)).toEqual(hoverResult);
    });

    it('returns cached result without calling worker', async () => {
      const hoverResult = { contents: { kind: 'markdown' as const, value: '**string**' } };
      const cacheKey = 'owner/repo/main/src/index.ts:10:5:lsp/hover';
      cache.set(cacheKey, hoverResult);

      const result = await router.handleRequest(createHoverRequest());

      expect(workerPool.getOrCreateWorker).not.toHaveBeenCalled();
      expect((result as LspHoverResponse).result).toEqual(hoverResult);
    });

    it('starts idle timer after request', async () => {
      await router.handleRequest(createHoverRequest());

      expect(workerPool.startIdleTimer).toHaveBeenCalledWith('typescript');
    });
  });

  describe('handleRequest — definition', () => {
    it('routes definition request correctly', async () => {
      const request: LspDefinitionRequest = {
        type: 'lsp/definition',
        requestId: 'req-2',
        owner: 'owner',
        repo: 'repo',
        ref: 'main',
        filePath: 'src/index.ts',
        position: { line: 5, character: 10 },
      };

      const managed = await workerPool.getOrCreateWorker('typescript');
      vi.spyOn(managed.transport, 'sendRequest').mockResolvedValue([]);

      const result = await router.handleRequest(request);

      expect(result.type).toBe('lsp/response');
      expect((result as LspDefinitionResponse).kind).toBe('definition');
    });
  });

  describe('handleRequest — signatureHelp', () => {
    it('routes signatureHelp request correctly', async () => {
      const request: LspSignatureHelpRequest = {
        type: 'lsp/signatureHelp',
        requestId: 'req-3',
        owner: 'owner',
        repo: 'repo',
        ref: 'main',
        filePath: 'src/index.ts',
        position: { line: 5, character: 10 },
      };

      const result = await router.handleRequest(request);

      expect(result.type).toBe('lsp/response');
    });
  });

  describe('unsupported language', () => {
    it('returns unsupported_language error for unknown extensions', async () => {
      const request = createHoverRequest({ filePath: 'README.md' });
      const result = await router.handleRequest(request);

      expect(result.type).toBe('lsp/error');
      expect((result as LspErrorResponse).error.code).toBe('unsupported_language');
    });

    it('does not call worker pool for unsupported languages', async () => {
      const request = createHoverRequest({ filePath: 'README.md' });
      await router.handleRequest(request);

      expect(workerPool.getOrCreateWorker).not.toHaveBeenCalled();
    });
  });

  describe('disabled language', () => {
    it('returns error when language is disabled in settings', async () => {
      settings.enabledLanguages = ['go', 'python']; // TypeScript disabled

      const request = createHoverRequest();
      const result = await router.handleRequest(request);

      expect(result.type).toBe('lsp/error');
      expect((result as LspErrorResponse).error.code).toBe('unsupported_language');
      expect((result as LspErrorResponse).error.message).toContain('disabled');
    });
  });

  describe('unavailable server', () => {
    it('returns error for Go files (no WASM server available)', async () => {
      const request = createHoverRequest({ filePath: 'main.go' });
      const result = await router.handleRequest(request);

      expect(result.type).toBe('lsp/error');
      expect((result as LspErrorResponse).error.code).toBe('unsupported_language');
      expect((result as LspErrorResponse).error.message).toContain('gopls');
    });

    it('returns error for Rust files (no WASM server available)', async () => {
      const request = createHoverRequest({ filePath: 'main.rs' });
      const result = await router.handleRequest(request);

      expect(result.type).toBe('lsp/error');
      expect((result as LspErrorResponse).error.code).toBe('unsupported_language');
      expect((result as LspErrorResponse).error.message).toContain('rust-analyzer');
    });

    it('returns error for Python files (no WASM server available)', async () => {
      const request = createHoverRequest({ filePath: 'main.py' });
      const result = await router.handleRequest(request);

      expect(result.type).toBe('lsp/error');
      expect((result as LspErrorResponse).error.code).toBe('unsupported_language');
      expect((result as LspErrorResponse).error.message).toContain('Pyright');
    });

    it('does not attempt to create worker for unavailable server', async () => {
      const request = createHoverRequest({ filePath: 'main.go' });
      await router.handleRequest(request);

      expect(workerPool.getOrCreateWorker).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('handles cancel request without error', async () => {
      const request: LspCancelRequest = {
        type: 'lsp/cancel',
        requestId: 'req-to-cancel',
      };

      const result = await router.handleRequest(request);
      // Cancel produces an error response acknowledging the cancellation
      expect(result.type).toBe('lsp/error');
    });
  });

  describe('worker errors', () => {
    it('returns lsp_server_error when worker request fails', async () => {
      const managed = await workerPool.getOrCreateWorker('typescript');
      vi.spyOn(managed.transport, 'sendRequest').mockRejectedValue(
        new Error('Worker crashed'),
      );

      const request = createHoverRequest();
      const result = await router.handleRequest(request);

      expect(result.type).toBe('lsp/error');
      expect((result as LspErrorResponse).error.code).toBe('lsp_server_error');
      expect((result as LspErrorResponse).error.message).toContain('Worker crashed');
    });
  });

  describe('definition null result', () => {
    it('returns empty array when transport returns null', async () => {
      const request: LspDefinitionRequest = {
        type: 'lsp/definition',
        requestId: 'req-def-null',
        owner: 'owner',
        repo: 'repo',
        ref: 'main',
        filePath: 'src/index.ts',
        position: { line: 5, character: 10 },
      };

      const managed = await workerPool.getOrCreateWorker('typescript');
      vi.spyOn(managed.transport, 'sendRequest').mockResolvedValue(null);

      const result = await router.handleRequest(request);

      expect(result.type).toBe('lsp/response');
      expect((result as LspDefinitionResponse).kind).toBe('definition');
      expect((result as LspDefinitionResponse).result).toEqual([]);
    });

    it('does not cache null definition result', async () => {
      const request: LspDefinitionRequest = {
        type: 'lsp/definition',
        requestId: 'req-def-null2',
        owner: 'owner',
        repo: 'repo',
        ref: 'main',
        filePath: 'src/index.ts',
        position: { line: 5, character: 10 },
      };

      const managed = await workerPool.getOrCreateWorker('typescript');
      vi.spyOn(managed.transport, 'sendRequest').mockResolvedValue(null);

      await router.handleRequest(request);

      // Should NOT be cached
      const cacheKey = 'owner/repo/main/src/index.ts:5:10:lsp/definition';
      expect(cache.get(cacheKey)).toBeNull();
    });
  });

  describe('document sync failure', () => {
    it('returns lsp_server_error when document sync fails', async () => {
      vi.mocked(docSync.ensureDocumentOpen).mockRejectedValueOnce(
        new Error('API fetch failed: 404'),
      );

      const request = createHoverRequest();
      const result = await router.handleRequest(request);

      expect(result.type).toBe('lsp/error');
      expect((result as LspErrorResponse).error.code).toBe('lsp_server_error');
      expect((result as LspErrorResponse).error.message).toContain('API fetch failed');
    });
  });

  describe('signatureHelp null result', () => {
    it('returns null result as-is (not coerced to empty array)', async () => {
      const request: LspSignatureHelpRequest = {
        type: 'lsp/signatureHelp',
        requestId: 'req-sig-null',
        owner: 'owner',
        repo: 'repo',
        ref: 'main',
        filePath: 'src/index.ts',
        position: { line: 5, character: 10 },
      };

      const managed = await workerPool.getOrCreateWorker('typescript');
      vi.spyOn(managed.transport, 'sendRequest').mockResolvedValue(null);

      const result = await router.handleRequest(request);

      expect(result.type).toBe('lsp/response');
      // signatureHelp returns null directly, not []
      expect((result as { result: unknown }).result).toBeNull();
    });
  });
});
