import type {
  GitHubContentsResponse,
  GitHubRateLimitInfo,
  ExtensionError,
} from '../shared/types';
import { GITHUB_API_BASE_URL, GITHUB_RATE_LIMIT_THRESHOLD } from '../shared/constants';
import { getSecureSettings } from '../shared/settings';

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const JITTER_MAX_MS = 1_000;

export interface RateLimitWarningCallback {
  (info: GitHubRateLimitInfo): void;
}

/**
 * HTTP client for fetching file content from GitHub's REST API.
 * Supports authenticated (PAT) and unauthenticated requests,
 * with rate limit detection and exponential backoff.
 */
export class GitHubApiClient {
  private rateLimitInfo: GitHubRateLimitInfo | null = null;
  private backoffUntil = 0;
  private onRateLimitWarning: RateLimitWarningCallback | null = null;

  setRateLimitWarningCallback(callback: RateLimitWarningCallback): void {
    this.onRateLimitWarning = callback;
  }

  /**
   * Fetches file content from the GitHub Contents API.
   * Returns the decoded file content as a string.
   */
  async fetchFileContent(
    owner: string,
    repo: string,
    ref: string,
    path: string,
  ): Promise<string> {
    const url = `${GITHUB_API_BASE_URL}/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`;
    const response = await this.makeRequest(url);

    const data = (await response.json()) as GitHubContentsResponse;

    if (data.encoding === 'base64') {
      return decodeBase64(data.content);
    }

    return data.content;
  }

  /**
   * Returns the current rate limit info, or null if no requests have been made.
   */
  getRateLimitInfo(): GitHubRateLimitInfo | null {
    return this.rateLimitInfo;
  }

  private async makeRequest(url: string): Promise<Response> {
    // Wait for any active backoff period
    await this.waitForBackoff();

    const headers = await this.getAuthHeaders();
    let lastError: ExtensionError | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = calculateBackoff(attempt);
        await sleep(delay);
      }

      let response: Response;
      try {
        response = await fetch(url, {
          headers: {
            Accept: 'application/vnd.github.v3+json',
            ...headers,
          },
        });
      } catch {
        lastError = {
          code: 'fetch_error',
          message: `Network error fetching ${url}`,
        };
        continue;
      }

      this.updateRateLimitInfo(response);

      if (response.ok) {
        return response;
      }

      // Map HTTP errors
      if (response.status === 404) {
        throw createApiError('fetch_not_found', `File not found: ${url}`);
      }

      if (response.status === 401) {
        throw createApiError(
          'fetch_unauthorized',
          'GitHub API authentication failed. Check your Personal Access Token.',
        );
      }

      if (response.status === 403 || response.status === 429) {
        const isRateLimit = this.isRateLimitResponse(response);
        if (isRateLimit) {
          const resetAt = this.rateLimitInfo?.resetAt ?? 0;
          const retryAfter = Math.max(0, resetAt - Date.now());
          this.backoffUntil = resetAt;

          lastError = {
            code: 'rate_limited',
            message: 'GitHub API rate limit exceeded.',
            retryAfter,
          };
          continue;
        }

        // 403 but not rate limit (e.g., access denied)
        throw createApiError(
          'fetch_unauthorized',
          `Access denied: ${response.status} ${response.statusText}`,
        );
      }

      // Other HTTP errors
      lastError = {
        code: 'fetch_error',
        message: `GitHub API error: ${response.status} ${response.statusText}`,
      };
    }

    throw lastError ?? createApiError('fetch_error', 'Request failed after retries');
  }

  private async getAuthHeaders(): Promise<Record<string, string>> {
    try {
      const secure = await getSecureSettings();
      if (secure.githubPat) {
        return { Authorization: `token ${secure.githubPat}` };
      }
    } catch {
      // If storage is unavailable, proceed without auth
    }
    return {};
  }

  private updateRateLimitInfo(response: Response): void {
    const limit = response.headers.get('X-RateLimit-Limit');
    const remaining = response.headers.get('X-RateLimit-Remaining');
    const reset = response.headers.get('X-RateLimit-Reset');
    const used = response.headers.get('X-RateLimit-Used');

    if (limit !== null && remaining !== null && reset !== null) {
      this.rateLimitInfo = {
        limit: parseInt(limit, 10),
        remaining: parseInt(remaining, 10),
        resetAt: parseInt(reset, 10) * 1000, // seconds → milliseconds
        used: used !== null ? parseInt(used, 10) : 0,
      };

      if (
        this.rateLimitInfo.remaining < GITHUB_RATE_LIMIT_THRESHOLD &&
        this.onRateLimitWarning
      ) {
        this.onRateLimitWarning(this.rateLimitInfo);
      }
    }
  }

  private isRateLimitResponse(response: Response): boolean {
    const remaining = response.headers.get('X-RateLimit-Remaining');
    if (remaining !== null && parseInt(remaining, 10) === 0) {
      return true;
    }
    // Some 429 responses indicate rate limiting without explicit headers
    return response.status === 429;
  }

  private async waitForBackoff(): Promise<void> {
    const now = Date.now();
    if (this.backoffUntil > now) {
      await sleep(this.backoffUntil - now);
    }
  }
}

/**
 * Calculates exponential backoff delay with random jitter.
 */
export function calculateBackoff(attempt: number): number {
  const exponential = Math.min(
    BASE_BACKOFF_MS * Math.pow(2, attempt),
    MAX_BACKOFF_MS,
  );
  const jitter = Math.random() * JITTER_MAX_MS;
  return exponential + jitter;
}

/**
 * Decodes a base64-encoded string. Handles the chunked format from
 * GitHub's API (content split across lines with newlines).
 */
export function decodeBase64(encoded: string): string {
  const cleaned = encoded.replace(/\n/g, '');
  return atob(cleaned);
}

function createApiError(
  code: ExtensionError['code'],
  message: string,
): ExtensionError {
  return { code, message };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
