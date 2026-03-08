# Phase 2: Background Service Worker — Core — Task Details

## Prerequisites
- Phase 1 complete (P1-T1 through P1-T5)

## Tasks

### P2-T1: Background Entry Point (`src/background/index.ts`)

**Purpose**: Central message hub that receives all extension messages and dispatches to appropriate handlers.

**Implementation guide**:

```typescript
// Listen for messages from content scripts
chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, sender, sendResponse) => {
    switch (message.type) {
      case 'lsp/hover':
      case 'lsp/definition':
      case 'lsp/signatureHelp':
        // Delegate to LSP router (Phase 3)
        handleLspRequest(message, sender).then(sendResponse);
        return true; // async response
      case 'lsp/cancel':
        handleCancelRequest(message);
        return false;
      case 'extension/toggle':
        handleToggle(message);
        return false;
      case 'page/navigated':
        handleNavigation(message, sender);
        return false;
    }
  }
);

// Listen for keyboard shortcut commands
chrome.commands.onCommand.addListener((command) => { ... });

// Listen for settings changes
chrome.storage.onChanged.addListener((changes, areaName) => { ... });
```

**Key behaviors**:
- Returns `true` from listener for async responses (LSP requests)
- Handles tab lifecycle (content script connect/disconnect)
- Initializes settings on service worker start

**Tests required**: Message dispatch routing (correct handler called for each type).

---

### P2-T2: GitHub API Client (`src/background/github-api.ts`)

**Purpose**: HTTP client for fetching file content from GitHub's REST API with auth and rate limit handling.

**Implementation guide**:

```typescript
export class GitHubApiClient {
  private rateLimitInfo: GitHubRateLimitInfo | null = null;
  private backoffUntil: number = 0;

  async fetchFileContent(
    owner: string, repo: string, ref: string, path: string
  ): Promise<string>;

  private async makeRequest(url: string): Promise<Response>;
  private getAuthHeaders(): HeadersInit;
  private handleRateLimit(response: Response): void;
  private async waitForBackoff(): Promise<void>;
}
```

**Key behaviors**:
- Constructs URL: `${GITHUB_API_BASE_URL}/repos/${owner}/${repo}/contents/${path}?ref=${ref}`
- Adds `Authorization: token ${pat}` header when PAT configured
- Parses `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `X-RateLimit-Limit` headers
- On 403/429: calculates backoff with exponential delay + jitter
- Base64 decodes file content from GitHub API response
- Maps HTTP errors to `ExtensionErrorCode`: 404→`fetch_not_found`, 401→`fetch_unauthorized`, network→`fetch_error`, 403 rate limit→`rate_limited`

**Tests required**:
- Auth header included when PAT set, omitted when not
- Rate limit headers parsed correctly
- Exponential backoff calculated correctly with jitter
- Base64 content decoding
- Error code mapping for each HTTP status
- Rate limit warning notification sent

---

### P2-T3: Response Cache (`src/background/cache.ts`)

**Purpose**: LRU cache with per-entry TTL for LSP responses and file contents.

**Implementation guide**:

```typescript
export class LruCache<T> {
  private entries: Map<string, CacheEntry<T>> = new Map();
  private maxEntries: number;
  private defaultTtlMs: number;

  constructor(maxEntries: number, defaultTtlMs: number);

  get(key: string): T | null;      // returns null if expired or missing
  set(key: string, value: T, ttlMs?: number): void;
  has(key: string): boolean;
  invalidateByPrefix(prefix: string): void;  // for ref change invalidation
  clear(): void;
  get size(): number;
}
```

**Cache key format**: `{owner}/{repo}/{ref}/{filePath}:{line}:{character}` for LSP responses, `{owner}/{repo}/{ref}/{filePath}` for file contents.

**Key behaviors**:
- LRU: on `get`, moves entry to end of Map (most recently used)
- On `set`, if max entries exceeded, evicts oldest (first) entry
- TTL: `get` checks `cachedAt + ttlMs > Date.now()`, returns null and deletes if expired
- `invalidateByPrefix`: deletes all entries whose key starts with the given prefix

**Tests required**:
- Cache hit returns value
- Cache miss returns null
- TTL expiration returns null
- LRU eviction removes oldest
- Prefix invalidation removes matching entries

---

### P2-T4: Document Sync (`src/background/document-sync.ts`)

**Purpose**: Manages which files have been opened on which workers, fetches content as needed, sends `textDocument/didOpen` notifications.

**Implementation guide**:

```typescript
export class DocumentSync {
  private openDocuments: Map<string, Set<string>> = new Map(); // workerId -> Set<fileUri>
  private fileContentCache: LruCache<string>;
  private apiClient: GitHubApiClient;

  async ensureDocumentOpen(
    workerId: string,
    owner: string, repo: string, ref: string, filePath: string,
    sendDidOpen: (uri: string, content: string, languageId: string) => void
  ): Promise<void>;

  handleFileRequest(
    workerId: string,
    requestedUri: string,
    sendDidOpen: (uri: string, content: string, languageId: string) => void
  ): Promise<void>;

  onWorkerTerminated(workerId: string): void;
}
```

**Key behaviors**:
- Checks if document is already open on the target worker
- If not open: fetches from file content cache or GitHub API
- Sends `textDocument/didOpen` with `{ uri, languageId, version: 1, text: content }`
- Tracks open documents per worker for cleanup
- On worker termination, removes tracking for that worker

**Tests required**: File fetched and didOpen sent on first request; cached content reused; worker cleanup removes tracking.

---

## Parallelization Notes

- P2-T2 and P2-T3 can be implemented **in parallel** (independent modules).
- P2-T4 depends on both P2-T2 and P2-T3.
- P2-T1 is a thin shell initially; it gets fleshed out as P3-T5 (LSP Router) is built.
