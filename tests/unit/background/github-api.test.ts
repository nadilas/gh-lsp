import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  GitHubApiClient,
  calculateBackoff,
  decodeBase64,
} from '../../../src/background/github-api';
import type { ExtensionError } from '../../../src/shared/types';

// Mock chrome.storage for getSecureSettings
const localStore: Record<string, unknown> = {};
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn(async (key: string) => ({ [key]: localStore[key] })),
      set: vi.fn(async (items: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(items)) {
          localStore[key] = value;
        }
      }),
    },
    sync: {
      get: vi.fn(async () => ({})),
      set: vi.fn(async () => undefined),
    },
  },
});

// Mock fetch
const mockFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
vi.stubGlobal('fetch', mockFetch);

// Mock atob for base64 decoding in jsdom
vi.stubGlobal(
  'atob',
  (str: string) => Buffer.from(str, 'base64').toString('binary'),
);

function createMockResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  const allHeaders = new Headers(headers);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : `Error ${status}`,
    headers: allHeaders,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function createSuccessResponse(
  content: string,
  headers: Record<string, string> = {},
): Response {
  const encoded = Buffer.from(content).toString('base64');
  return createMockResponse(
    {
      name: 'test.ts',
      path: 'src/test.ts',
      sha: 'abc123',
      size: content.length,
      encoding: 'base64' as const,
      content: encoded,
      download_url: null,
    },
    200,
    {
      'X-RateLimit-Limit': '60',
      'X-RateLimit-Remaining': '55',
      'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 3600),
      'X-RateLimit-Used': '5',
      ...headers,
    },
  );
}

function clearStore(): void {
  for (const key of Object.keys(localStore)) {
    delete localStore[key];
  }
}

describe('GitHubApiClient', () => {
  let client: GitHubApiClient;

  beforeEach(() => {
    vi.useFakeTimers();
    client = new GitHubApiClient();
    clearStore();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('fetchFileContent', () => {
    it('returns decoded file content', async () => {
      mockFetch.mockResolvedValueOnce(
        createSuccessResponse('const x = 42;'),
      );

      const content = await client.fetchFileContent(
        'owner',
        'repo',
        'main',
        'src/test.ts',
      );

      expect(content).toBe('const x = 42;');
    });

    it('constructs correct URL with encoded ref', async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(''));

      await client.fetchFileContent(
        'owner',
        'repo',
        'feat/my-branch',
        'src/index.ts',
      );

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/owner/repo/contents/src/index.ts?ref=feat%2Fmy-branch',
        expect.objectContaining({
          headers: expect.objectContaining({
            Accept: 'application/vnd.github.v3+json',
          }),
        }),
      );
    });
  });

  describe('authentication', () => {
    it('includes Authorization header when PAT is configured', async () => {
      localStore['gh-lsp-secure'] = { githubPat: 'ghp_test123' };
      mockFetch.mockResolvedValueOnce(createSuccessResponse(''));

      await client.fetchFileContent('owner', 'repo', 'main', 'file.ts');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'token ghp_test123',
          }),
        }),
      );
    });

    it('omits Authorization header when no PAT is configured', async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(''));

      await client.fetchFileContent('owner', 'repo', 'main', 'file.ts');

      const callHeaders = mockFetch.mock.calls[0]?.[1]?.headers as Record<
        string,
        string
      >;
      expect(callHeaders).not.toHaveProperty('Authorization');
    });

    it('omits Authorization header when PAT is empty string', async () => {
      localStore['gh-lsp-secure'] = { githubPat: '' };
      mockFetch.mockResolvedValueOnce(createSuccessResponse(''));

      await client.fetchFileContent('owner', 'repo', 'main', 'file.ts');

      const callHeaders = mockFetch.mock.calls[0]?.[1]?.headers as Record<
        string,
        string
      >;
      expect(callHeaders).not.toHaveProperty('Authorization');
    });
  });

  describe('rate limit header parsing', () => {
    it('parses rate limit headers from response', async () => {
      const resetTime = Math.floor(Date.now() / 1000) + 3600;
      mockFetch.mockResolvedValueOnce(
        createSuccessResponse('', {
          'X-RateLimit-Limit': '5000',
          'X-RateLimit-Remaining': '4999',
          'X-RateLimit-Reset': String(resetTime),
          'X-RateLimit-Used': '1',
        }),
      );

      await client.fetchFileContent('owner', 'repo', 'main', 'file.ts');

      const info = client.getRateLimitInfo();
      expect(info).not.toBeNull();
      expect(info!.limit).toBe(5000);
      expect(info!.remaining).toBe(4999);
      expect(info!.resetAt).toBe(resetTime * 1000);
      expect(info!.used).toBe(1);
    });

    it('fires rate limit warning when remaining < threshold', async () => {
      const warningCallback = vi.fn();
      client.setRateLimitWarningCallback(warningCallback);

      mockFetch.mockResolvedValueOnce(
        createSuccessResponse('', {
          'X-RateLimit-Limit': '60',
          'X-RateLimit-Remaining': '5',
          'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 60),
          'X-RateLimit-Used': '55',
        }),
      );

      await client.fetchFileContent('owner', 'repo', 'main', 'file.ts');

      expect(warningCallback).toHaveBeenCalledTimes(1);
      expect(warningCallback).toHaveBeenCalledWith(
        expect.objectContaining({ remaining: 5 }),
      );
    });

    it('does not fire warning when remaining >= threshold', async () => {
      const warningCallback = vi.fn();
      client.setRateLimitWarningCallback(warningCallback);

      mockFetch.mockResolvedValueOnce(
        createSuccessResponse('', {
          'X-RateLimit-Limit': '60',
          'X-RateLimit-Remaining': '50',
          'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 60),
        }),
      );

      await client.fetchFileContent('owner', 'repo', 'main', 'file.ts');

      expect(warningCallback).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('throws fetch_not_found for 404 responses', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ message: 'Not Found' }, 404),
      );

      await expect(
        client.fetchFileContent('owner', 'repo', 'main', 'missing.ts'),
      ).rejects.toMatchObject({
        code: 'fetch_not_found',
      } satisfies Partial<ExtensionError>);
    });

    it('throws fetch_unauthorized for 401 responses', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ message: 'Bad credentials' }, 401),
      );

      await expect(
        client.fetchFileContent('owner', 'repo', 'main', 'file.ts'),
      ).rejects.toMatchObject({
        code: 'fetch_unauthorized',
      } satisfies Partial<ExtensionError>);
    });

    it('throws rate_limited for 403 with zero remaining', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({ message: 'rate limit exceeded' }, 403, {
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Limit': '60',
          'X-RateLimit-Reset': String(
            Math.floor(Date.now() / 1000) + 60,
          ),
        }),
      );

      let caughtError: unknown;
      const promise = client
        .fetchFileContent('owner', 'repo', 'main', 'file.ts')
        .catch((e) => { caughtError = e; });

      for (let i = 0; i < 10; i++) {
        await vi.advanceTimersByTimeAsync(120_000);
      }
      await promise;

      expect(caughtError).toMatchObject({
        code: 'rate_limited',
      } satisfies Partial<ExtensionError>);
    });

    it('throws rate_limited for 429 responses', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({ message: 'Too Many Requests' }, 429),
      );

      let caughtError: unknown;
      const promise = client
        .fetchFileContent('owner', 'repo', 'main', 'file.ts')
        .catch((e) => { caughtError = e; });

      for (let i = 0; i < 10; i++) {
        await vi.advanceTimersByTimeAsync(120_000);
      }
      await promise;

      expect(caughtError).toMatchObject({
        code: 'rate_limited',
      } satisfies Partial<ExtensionError>);
    });

    it('throws fetch_error for network errors', async () => {
      mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

      let caughtError: unknown;
      const promise = client
        .fetchFileContent('owner', 'repo', 'main', 'file.ts')
        .catch((e) => { caughtError = e; });

      for (let i = 0; i < 10; i++) {
        await vi.advanceTimersByTimeAsync(120_000);
      }
      await promise;

      expect(caughtError).toMatchObject({
        code: 'fetch_error',
      } satisfies Partial<ExtensionError>);
    });
  });

  describe('getRateLimitInfo', () => {
    it('returns null before any requests', () => {
      expect(client.getRateLimitInfo()).toBeNull();
    });
  });
});

describe('calculateBackoff', () => {
  it('increases exponentially with attempt number', () => {
    // We can only verify the exponential base since jitter is random
    const attempt1Values: number[] = [];
    const attempt3Values: number[] = [];

    for (let i = 0; i < 100; i++) {
      attempt1Values.push(calculateBackoff(1));
      attempt3Values.push(calculateBackoff(3));
    }

    const minAttempt1 = Math.min(...attempt1Values);
    const minAttempt3 = Math.min(...attempt3Values);

    // attempt 1: base * 2^1 = 2000 (+ jitter 0-1000)
    expect(minAttempt1).toBeGreaterThanOrEqual(2000);
    expect(minAttempt1).toBeLessThan(3001);

    // attempt 3: base * 2^3 = 8000 (+ jitter 0-1000)
    expect(minAttempt3).toBeGreaterThanOrEqual(8000);
    expect(minAttempt3).toBeLessThan(9001);
  });

  it('caps at MAX_BACKOFF_MS', () => {
    // attempt 10: base * 2^10 = 1024000, should be capped at 30000
    const values: number[] = [];
    for (let i = 0; i < 100; i++) {
      values.push(calculateBackoff(10));
    }

    const maxValue = Math.max(...values);
    expect(maxValue).toBeLessThanOrEqual(31_000); // 30000 + 1000 jitter
  });
});

describe('decodeBase64', () => {
  it('decodes simple base64 content', () => {
    const encoded = Buffer.from('const x = 42;').toString('base64');
    expect(decodeBase64(encoded)).toBe('const x = 42;');
  });

  it('handles newlines in base64 content (GitHub API format)', () => {
    const content = 'Hello, world!';
    const encoded = Buffer.from(content).toString('base64');
    // Simulate GitHub's chunked format with embedded newlines
    const chunked = encoded.slice(0, 4) + '\n' + encoded.slice(4);
    expect(decodeBase64(chunked)).toBe(content);
  });

  it('handles empty content', () => {
    expect(decodeBase64('')).toBe('');
  });

  it('decodes multi-line file content', () => {
    const content = 'line 1\nline 2\nline 3\n';
    const encoded = Buffer.from(content).toString('base64');
    expect(decodeBase64(encoded)).toBe(content);
  });
});
