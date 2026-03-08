# Phase 3: LSP Worker Infrastructure — Task Details

## Prerequisites
- Phase 1 complete
- P2-T3 (Response Cache) complete
- P2-T4 (Document Sync) complete

## Tasks

### P3-T1: JSON-RPC 2.0 Transport (`src/workers/lsp-worker.ts`)

**Purpose**: Encode/decode JSON-RPC 2.0 messages over `postMessage`, correlate requests with responses, handle timeouts.

**Implementation guide**:

```typescript
export class JsonRpcTransport {
  private nextId: number = 1;
  private pendingRequests: Map<number | string, {
    resolve: (result: unknown) => void;
    reject: (error: JsonRpcErrorObject) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = new Map();

  constructor(
    private postMessage: (msg: unknown) => void,
    private defaultTimeoutMs: number = 30000
  );

  // Send a request and wait for correlated response
  sendRequest<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T>;

  // Send a notification (fire-and-forget)
  sendNotification(method: string, params?: unknown): void;

  // Handle incoming message (call from onmessage handler)
  handleMessage(data: unknown): void;

  // Cancel a pending request
  cancelRequest(id: number | string): void;
}

// Type guards
export function isJsonRpcRequest(msg: unknown): msg is JsonRpcRequest;
export function isJsonRpcNotification(msg: unknown): msg is JsonRpcNotification;
export function isJsonRpcResponse(msg: unknown): msg is JsonRpcSuccessResponse | JsonRpcErrorResponse;

// Factories
export function createJsonRpcRequest(id: number | string, method: string, params?: unknown): JsonRpcRequest;
export function createJsonRpcNotification(method: string, params?: unknown): JsonRpcNotification;
export function createJsonRpcSuccessResponse(id: number | string, result: unknown): JsonRpcSuccessResponse;
export function createJsonRpcErrorResponse(id: number | string | null, code: number, message: string, data?: unknown): JsonRpcErrorResponse;
```

**Key behaviors**:
- `sendRequest` generates unique ID, stores pending handler, sends via `postMessage`, returns Promise
- `handleMessage` checks if incoming message is a response (has `id` + `result`/`error`), resolves/rejects matching pending request
- Timeout: if response not received within `timeoutMs`, rejects with `LspErrorCode.RequestCancelled`
- `cancelRequest`: sends `$/cancelRequest` notification, rejects pending promise

**Tests required**:
- Request-response correlation (correct response resolves correct promise)
- Timeout rejects with correct error code
- Notification does not create pending entry
- Type guards correctly identify message types
- Cancel sends notification and rejects promise

---

### P3-T2: Virtual File System (`src/workers/vfs.ts`)

**Purpose**: In-memory file storage for WASM language servers operating without filesystem access.

**Implementation guide**:

```typescript
export class VirtualFileSystem {
  private files: Map<string, { content: string; version: number }> = new Map();
  private onFileNotFound?: (uri: string) => void;

  constructor(onFileNotFound?: (uri: string) => void);

  registerFile(uri: string, content: string, version: number): void;
  getFile(uri: string): { content: string; version: number } | null;
  hasFile(uri: string): boolean;
  removeFile(uri: string): boolean;
  listFiles(): string[];
  updateFile(uri: string, content: string): void; // increments version
  clear(): void;

  // Called by WASM server when it tries to read a file
  requestFile(uri: string): { content: string; version: number } | null;
}
```

**Key behaviors**:
- `registerFile`: stores file content and version, overwrites if exists
- `getFile`: returns content and version, or null if not registered
- `requestFile`: tries `getFile`, if null calls `onFileNotFound` callback (which triggers `gh-lsp/requestFile` notification to background)
- `updateFile`: updates content and increments version number

**Tests required**:
- Register and retrieve file
- Get non-existent file returns null
- Request non-existent file triggers callback
- Update increments version
- Remove deletes file
- List returns all URIs

---

### P3-T3: Language Registry — Worker-side (`src/workers/language-registry.ts`)

**Purpose**: Load WASM binaries and declare per-language server capabilities.

**Implementation guide**:

```typescript
import type { SupportedLanguage, LspServerCapabilities } from '@shared/types';

export interface WasmServer {
  initialize(params: unknown): Promise<unknown>;
  handleRequest(method: string, params: unknown): Promise<unknown>;
  handleNotification(method: string, params: unknown): void;
  shutdown(): Promise<void>;
}

export async function loadWasmServer(
  language: SupportedLanguage,
  wasmPath: string,
  vfs: VirtualFileSystem
): Promise<WasmServer>;

export function getCapabilities(language: SupportedLanguage): LspServerCapabilities;

// Capability declarations
const CAPABILITIES: Record<SupportedLanguage, LspServerCapabilities> = {
  typescript: { hoverProvider: true, definitionProvider: true, signatureHelpProvider: true },
  javascript: { hoverProvider: true, definitionProvider: true, signatureHelpProvider: true },
  go:         { hoverProvider: true, definitionProvider: true, signatureHelpProvider: false },
  rust:       { hoverProvider: true, definitionProvider: true, signatureHelpProvider: false },
  python:     { hoverProvider: true, definitionProvider: true, signatureHelpProvider: true },
};
```

**Tests required**: Capability declaration for each language; loadWasmServer with mocked fetch/instantiate.

---

### P3-T4: Worker Pool Manager (`src/background/worker-pool.ts`)

**Purpose**: Manage lifecycle of Web Workers, each running one language's LSP server.

**Implementation guide**:

```typescript
export interface ManagedWorker {
  id: string;
  language: SupportedLanguage;
  worker: Worker;
  transport: JsonRpcTransport;
  status: WorkerStatus;
  lastUsedAt: number;
  pendingRequests: Set<string>;
}

export class WorkerPool {
  private workers: Map<string, ManagedWorker> = new Map(); // language -> worker
  private maxWorkers: number;
  private idleTimeoutMs: number;
  private idleTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor(maxWorkers: number, idleTimeoutMs: number);

  async getOrCreateWorker(language: SupportedLanguage): Promise<ManagedWorker>;
  async terminateWorker(language: SupportedLanguage): Promise<void>;
  async terminateAll(): Promise<void>;

  private async spawnWorker(language: SupportedLanguage): Promise<ManagedWorker>;
  private evictLru(): Promise<void>;
  private resetIdleTimer(language: SupportedLanguage): void;
  private handleWorkerError(language: SupportedLanguage, error: ErrorEvent): void;
  private handleWorkerCrash(language: SupportedLanguage): void;
}
```

**Key behaviors**:
- `getOrCreateWorker`: checks existing workers first, spawns new if needed, evicts LRU if at capacity
- Spawn: creates Worker, initializes JsonRpcTransport, sends LSP `initialize`, waits for response, sends `initialized`
- Idle timeout: starts timer after each request completes; on expiry sends `shutdown`→`exit`→terminate
- Crash recovery: `onerror` handler terminates worker, rejects pending requests with `lsp_server_error`, next request spawns fresh
- LRU eviction: terminates worker with oldest `lastUsedAt`
- Status tracking: updates `WorkerStatus` and notifies content scripts

**Tests required**:
- Reuses existing worker for same language
- Spawns new worker for new language
- Evicts LRU when at max capacity
- Idle timeout terminates worker
- Crash rejects pending and allows respawn
- Status updates emitted correctly

---

### P3-T5: LSP Router (`src/background/lsp-router.ts`)

**Purpose**: Top-level request handler that ties together language detection, document sync, worker pool, cache, and response forwarding.

**Implementation guide**:

```typescript
export class LspRouter {
  constructor(
    private workerPool: WorkerPool,
    private documentSync: DocumentSync,
    private cache: LruCache<unknown>,
    private settings: () => Promise<ExtensionSettings>
  );

  async handleRequest(message: ExtensionMessage, tabId: number): Promise<ExtensionMessage>;

  private async handleHover(request: LspHoverRequest): Promise<LspHoverResponse | LspErrorResponse>;
  private async handleDefinition(request: LspDefinitionRequest): Promise<LspDefinitionResponse | LspErrorResponse>;
  private async handleSignatureHelp(request: LspSignatureHelpRequest): Promise<LspSignatureHelpResponse | LspErrorResponse>;
  private handleCancel(request: LspCancelRequest): void;
}
```

**Request flow**:
1. Extract language from file path extension
2. If unsupported → return `unsupported_language` error
3. If language is disabled in settings → return `unsupported_language` error
4. Check cache → if hit, return cached result
5. Get/create worker via pool
6. Ensure document is open via document sync
7. Send JSON-RPC request to worker
8. Cache result
9. Return response

**Tests required**:
- Routes hover to correct language worker
- Returns unsupported_language for unknown extensions
- Cache hit skips worker request
- Cancel forwards to worker transport
- Disabled language returns error

---

## Parallelization Notes

- P3-T1 and P3-T2 can be implemented **in parallel** (independent modules).
- P3-T3 depends on P3-T2 (needs VFS).
- P3-T4 depends on P3-T1 (needs transport).
- P3-T5 depends on P3-T4, P2-T4, and P1-T5 (ties everything together).
