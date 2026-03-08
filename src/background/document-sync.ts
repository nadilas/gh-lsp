import type { GitHubApiClient } from './github-api';
import type { LruCache } from './cache';
import { getLanguageForFilePath } from '../shared/languages';

/**
 * Callback signature for sending textDocument/didOpen to a worker.
 */
export interface SendDidOpenFn {
  (uri: string, content: string, languageId: string): void;
}

/**
 * Manages which files have been opened on which workers, fetches
 * content as needed, and sends textDocument/didOpen notifications.
 *
 * Tracks open documents per worker so cleanup is possible when
 * a worker is terminated.
 */
export class DocumentSync {
  /** workerId → Set of file URIs opened on that worker */
  private openDocuments: Map<string, Set<string>> = new Map();
  private readonly fileContentCache: LruCache<string>;
  private readonly apiClient: GitHubApiClient;

  constructor(apiClient: GitHubApiClient, fileContentCache: LruCache<string>) {
    this.apiClient = apiClient;
    this.fileContentCache = fileContentCache;
  }

  /**
   * Ensures a document is open on the given worker. If the file hasn't
   * been opened on this worker yet, fetches content (from cache or API)
   * and sends a textDocument/didOpen notification.
   */
  async ensureDocumentOpen(
    workerId: string,
    owner: string,
    repo: string,
    ref: string,
    filePath: string,
    sendDidOpen: SendDidOpenFn,
  ): Promise<void> {
    const uri = buildFileUri(owner, repo, ref, filePath);

    // Check if already open on this worker
    const workerDocs = this.openDocuments.get(workerId);
    if (workerDocs?.has(uri)) {
      return;
    }

    // Fetch content from cache or API
    const cacheKey = `${owner}/${repo}/${ref}/${filePath}`;
    let content = this.fileContentCache.get(cacheKey);

    if (content === null) {
      content = await this.apiClient.fetchFileContent(
        owner,
        repo,
        ref,
        filePath,
      );
      this.fileContentCache.set(cacheKey, content);
    }

    // Detect language
    const languageId = getLanguageForFilePath(filePath) ?? 'plaintext';

    // Send didOpen and track
    sendDidOpen(uri, content, languageId);
    this.trackDocument(workerId, uri);
  }

  /**
   * Handles a file request from a worker (e.g., cross-file resolution).
   * Parses the URI to extract repo context and fetches the file.
   */
  async handleFileRequest(
    workerId: string,
    requestedUri: string,
    sendDidOpen: SendDidOpenFn,
  ): Promise<void> {
    const parsed = parseFileUri(requestedUri);
    if (!parsed) {
      return;
    }

    await this.ensureDocumentOpen(
      workerId,
      parsed.owner,
      parsed.repo,
      parsed.ref,
      parsed.filePath,
      sendDidOpen,
    );
  }

  /**
   * Removes all document tracking for a terminated worker.
   */
  onWorkerTerminated(workerId: string): void {
    this.openDocuments.delete(workerId);
  }

  /**
   * Returns the set of URIs currently open on a given worker.
   */
  getOpenDocuments(workerId: string): ReadonlySet<string> {
    return this.openDocuments.get(workerId) ?? new Set();
  }

  private trackDocument(workerId: string, uri: string): void {
    let workerDocs = this.openDocuments.get(workerId);
    if (!workerDocs) {
      workerDocs = new Set();
      this.openDocuments.set(workerId, workerDocs);
    }
    workerDocs.add(uri);
  }
}

/**
 * Constructs a file URI in the format: gh-lsp://owner/repo/ref/path
 */
export function buildFileUri(
  owner: string,
  repo: string,
  ref: string,
  filePath: string,
): string {
  return `gh-lsp://${owner}/${repo}/${ref}/${filePath}`;
}

/**
 * Parses a gh-lsp:// URI back into its components.
 */
export function parseFileUri(
  uri: string,
): { owner: string; repo: string; ref: string; filePath: string } | null {
  const prefix = 'gh-lsp://';
  if (!uri.startsWith(prefix)) {
    return null;
  }

  const rest = uri.slice(prefix.length);
  const parts = rest.split('/');

  // Need at least owner/repo/ref/filePath (4+ segments)
  if (parts.length < 4) {
    return null;
  }

  const owner = parts[0]!;
  const repo = parts[1]!;
  const ref = parts[2]!;
  const filePath = parts.slice(3).join('/');

  if (!owner || !repo || !ref || !filePath) {
    return null;
  }

  return { owner, repo, ref, filePath };
}
