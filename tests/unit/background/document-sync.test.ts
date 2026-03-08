import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DocumentSync,
  buildFileUri,
  parseFileUri,
} from '../../../src/background/document-sync';
import type { GitHubApiClient } from '../../../src/background/github-api';
import { LruCache } from '../../../src/background/cache';

function createMockApiClient(): GitHubApiClient {
  return {
    fetchFileContent: vi.fn(async () => 'file content'),
    getRateLimitInfo: vi.fn(() => null),
    setRateLimitWarningCallback: vi.fn(),
  } as unknown as GitHubApiClient;
}

describe('DocumentSync', () => {
  let sync: DocumentSync;
  let apiClient: ReturnType<typeof createMockApiClient>;
  let cache: LruCache<string>;
  let sendDidOpen: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    apiClient = createMockApiClient();
    cache = new LruCache<string>(100, 600_000);
    sync = new DocumentSync(apiClient, cache);
    sendDidOpen = vi.fn();
  });

  describe('ensureDocumentOpen', () => {
    it('fetches content and sends didOpen on first request', async () => {
      await sync.ensureDocumentOpen(
        'worker-1',
        'owner',
        'repo',
        'main',
        'src/index.ts',
        sendDidOpen,
      );

      expect(apiClient.fetchFileContent).toHaveBeenCalledWith(
        'owner',
        'repo',
        'main',
        'src/index.ts',
      );
      expect(sendDidOpen).toHaveBeenCalledWith(
        'gh-lsp://owner/repo/main/src/index.ts',
        'file content',
        'typescript',
      );
    });

    it('skips fetch when document is already open on the same worker', async () => {
      await sync.ensureDocumentOpen(
        'worker-1',
        'owner',
        'repo',
        'main',
        'src/index.ts',
        sendDidOpen,
      );

      // Second call for same file on same worker
      await sync.ensureDocumentOpen(
        'worker-1',
        'owner',
        'repo',
        'main',
        'src/index.ts',
        sendDidOpen,
      );

      expect(apiClient.fetchFileContent).toHaveBeenCalledTimes(1);
      expect(sendDidOpen).toHaveBeenCalledTimes(1);
    });

    it('opens document on a different worker even if already open elsewhere', async () => {
      await sync.ensureDocumentOpen(
        'worker-1',
        'owner',
        'repo',
        'main',
        'src/index.ts',
        sendDidOpen,
      );

      await sync.ensureDocumentOpen(
        'worker-2',
        'owner',
        'repo',
        'main',
        'src/index.ts',
        sendDidOpen,
      );

      // API only called once (second uses cache), but didOpen sent to both workers
      expect(apiClient.fetchFileContent).toHaveBeenCalledTimes(1);
      expect(sendDidOpen).toHaveBeenCalledTimes(2);
    });

    it('uses cached content instead of fetching again', async () => {
      // Pre-populate cache
      cache.set('owner/repo/main/src/index.ts', 'cached content');

      await sync.ensureDocumentOpen(
        'worker-1',
        'owner',
        'repo',
        'main',
        'src/index.ts',
        sendDidOpen,
      );

      expect(apiClient.fetchFileContent).not.toHaveBeenCalled();
      expect(sendDidOpen).toHaveBeenCalledWith(
        'gh-lsp://owner/repo/main/src/index.ts',
        'cached content',
        'typescript',
      );
    });

    it('caches fetched content for future use', async () => {
      await sync.ensureDocumentOpen(
        'worker-1',
        'owner',
        'repo',
        'main',
        'src/index.ts',
        sendDidOpen,
      );

      expect(cache.has('owner/repo/main/src/index.ts')).toBe(true);
    });

    it('detects language from file path', async () => {
      await sync.ensureDocumentOpen(
        'worker-1',
        'owner',
        'repo',
        'main',
        'main.go',
        sendDidOpen,
      );

      expect(sendDidOpen).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'go',
      );
    });

    it('uses plaintext for unknown file types', async () => {
      await sync.ensureDocumentOpen(
        'worker-1',
        'owner',
        'repo',
        'main',
        'Makefile',
        sendDidOpen,
      );

      expect(sendDidOpen).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'plaintext',
      );
    });
  });

  describe('handleFileRequest', () => {
    it('opens a file from a gh-lsp:// URI', async () => {
      await sync.handleFileRequest(
        'worker-1',
        'gh-lsp://owner/repo/main/src/utils.ts',
        sendDidOpen,
      );

      expect(apiClient.fetchFileContent).toHaveBeenCalledWith(
        'owner',
        'repo',
        'main',
        'src/utils.ts',
      );
      expect(sendDidOpen).toHaveBeenCalled();
    });

    it('does nothing for invalid URIs', async () => {
      await sync.handleFileRequest(
        'worker-1',
        'https://example.com/file.ts',
        sendDidOpen,
      );

      expect(apiClient.fetchFileContent).not.toHaveBeenCalled();
      expect(sendDidOpen).not.toHaveBeenCalled();
    });
  });

  describe('onWorkerTerminated', () => {
    it('removes all tracking for the terminated worker', async () => {
      await sync.ensureDocumentOpen(
        'worker-1',
        'owner',
        'repo',
        'main',
        'src/index.ts',
        sendDidOpen,
      );

      sync.onWorkerTerminated('worker-1');

      expect(sync.getOpenDocuments('worker-1').size).toBe(0);
    });

    it('does not affect other workers', async () => {
      await sync.ensureDocumentOpen(
        'worker-1',
        'owner',
        'repo',
        'main',
        'src/a.ts',
        sendDidOpen,
      );
      await sync.ensureDocumentOpen(
        'worker-2',
        'owner',
        'repo',
        'main',
        'src/b.ts',
        sendDidOpen,
      );

      sync.onWorkerTerminated('worker-1');

      expect(sync.getOpenDocuments('worker-1').size).toBe(0);
      expect(sync.getOpenDocuments('worker-2').size).toBe(1);
    });

    it('allows re-opening documents after worker restart', async () => {
      await sync.ensureDocumentOpen(
        'worker-1',
        'owner',
        'repo',
        'main',
        'src/index.ts',
        sendDidOpen,
      );

      sync.onWorkerTerminated('worker-1');

      // Re-open on a new worker with same ID
      await sync.ensureDocumentOpen(
        'worker-1',
        'owner',
        'repo',
        'main',
        'src/index.ts',
        sendDidOpen,
      );

      // didOpen sent again (cache hit, so no API call)
      expect(sendDidOpen).toHaveBeenCalledTimes(2);
    });
  });

  describe('getOpenDocuments', () => {
    it('returns empty set for unknown worker', () => {
      expect(sync.getOpenDocuments('unknown').size).toBe(0);
    });

    it('returns open documents for a worker', async () => {
      await sync.ensureDocumentOpen(
        'worker-1',
        'owner',
        'repo',
        'main',
        'src/a.ts',
        sendDidOpen,
      );
      await sync.ensureDocumentOpen(
        'worker-1',
        'owner',
        'repo',
        'main',
        'src/b.ts',
        sendDidOpen,
      );

      const docs = sync.getOpenDocuments('worker-1');
      expect(docs.size).toBe(2);
      expect(docs.has('gh-lsp://owner/repo/main/src/a.ts')).toBe(true);
      expect(docs.has('gh-lsp://owner/repo/main/src/b.ts')).toBe(true);
    });
  });
});

describe('buildFileUri', () => {
  it('constructs gh-lsp:// URI', () => {
    expect(buildFileUri('owner', 'repo', 'main', 'src/index.ts')).toBe(
      'gh-lsp://owner/repo/main/src/index.ts',
    );
  });

  it('handles nested paths', () => {
    expect(
      buildFileUri('org', 'project', 'v1.0', 'src/lib/utils/helper.ts'),
    ).toBe('gh-lsp://org/project/v1.0/src/lib/utils/helper.ts');
  });
});

describe('parseFileUri', () => {
  it('parses valid gh-lsp:// URI', () => {
    const result = parseFileUri('gh-lsp://owner/repo/main/src/index.ts');
    expect(result).toEqual({
      owner: 'owner',
      repo: 'repo',
      ref: 'main',
      filePath: 'src/index.ts',
    });
  });

  it('handles nested file paths', () => {
    const result = parseFileUri(
      'gh-lsp://org/project/v2/src/lib/deep/file.ts',
    );
    expect(result).toEqual({
      owner: 'org',
      repo: 'project',
      ref: 'v2',
      filePath: 'src/lib/deep/file.ts',
    });
  });

  it('returns null for non gh-lsp:// URIs', () => {
    expect(parseFileUri('https://github.com/owner/repo')).toBeNull();
    expect(parseFileUri('file:///tmp/test.ts')).toBeNull();
  });

  it('returns null for malformed URIs with too few segments', () => {
    expect(parseFileUri('gh-lsp://owner/repo')).toBeNull();
    expect(parseFileUri('gh-lsp://owner')).toBeNull();
    expect(parseFileUri('gh-lsp://')).toBeNull();
  });
});
