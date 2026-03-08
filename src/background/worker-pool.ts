import type { SupportedLanguage, WorkerStatus } from '../shared/types';
import { JsonRpcTransport } from '../workers/lsp-worker';
import { getCapabilities } from '../workers/language-registry';
import { getWasmPath } from '../shared/languages';

/**
 * Represents a managed Web Worker running an LSP server.
 */
export interface ManagedWorker {
  id: string;
  language: SupportedLanguage;
  worker: Worker;
  transport: JsonRpcTransport;
  status: WorkerStatus;
  lastUsedAt: number;
  pendingRequests: Set<string>;
}

export interface WorkerStatusCallback {
  (language: SupportedLanguage, status: WorkerStatus): void;
}

export interface WorkerFactory {
  (language: SupportedLanguage): Worker;
}

/**
 * Manages the lifecycle of Web Workers running WASM LSP servers.
 * Handles spawning, reuse, idle timeout, LRU eviction, and crash recovery.
 */
export class WorkerPool {
  private workers: Map<SupportedLanguage, ManagedWorker> = new Map();
  private idleTimers: Map<SupportedLanguage, ReturnType<typeof setTimeout>> =
    new Map();
  private readonly maxWorkers: number;
  private readonly idleTimeoutMs: number;
  private onStatusChange: WorkerStatusCallback | null = null;
  private workerFactory: WorkerFactory;

  constructor(
    maxWorkers: number,
    idleTimeoutMs: number,
    workerFactory?: WorkerFactory,
  ) {
    this.maxWorkers = maxWorkers;
    this.idleTimeoutMs = idleTimeoutMs;
    this.workerFactory = workerFactory ?? defaultWorkerFactory;
  }

  setStatusCallback(callback: WorkerStatusCallback): void {
    this.onStatusChange = callback;
  }

  /**
   * Returns an existing worker for the language, or spawns a new one.
   * If at max capacity, evicts the least recently used worker first.
   */
  async getOrCreateWorker(
    language: SupportedLanguage,
  ): Promise<ManagedWorker> {
    const existing = this.workers.get(language);
    if (existing && existing.status !== 'error' && existing.status !== 'terminated') {
      existing.lastUsedAt = Date.now();
      this.clearIdleTimer(language);
      return existing;
    }

    // Evict LRU if at capacity
    if (this.workers.size >= this.maxWorkers) {
      await this.evictLru();
    }

    return this.spawnWorker(language);
  }

  /**
   * Spawns a new worker, initializes it via LSP initialize handshake.
   */
  private async spawnWorker(
    language: SupportedLanguage,
  ): Promise<ManagedWorker> {
    this.updateStatus(language, 'loading');

    const worker = this.workerFactory(language);
    const transport = new JsonRpcTransport(
      (msg) => worker.postMessage(msg),
      30_000,
    );

    const managed: ManagedWorker = {
      id: `${language}-${Date.now()}`,
      language,
      worker,
      transport,
      status: 'loading',
      lastUsedAt: Date.now(),
      pendingRequests: new Set(),
    };

    // Wire up message handler
    worker.onmessage = (event: MessageEvent) => {
      transport.handleMessage(event.data);
    };

    // Wire up error handler
    worker.onerror = (event: ErrorEvent) => {
      this.handleWorkerError(language, event);
    };

    this.workers.set(language, managed);

    // LSP initialize handshake
    try {
      this.updateStatus(language, 'initializing');
      managed.status = 'initializing';

      const capabilities = getCapabilities(language);
      await transport.sendRequest('initialize', {
        processId: null,
        rootUri: null,
        capabilities: {},
        initializationOptions: {
          language,
          wasmPath: getWasmPath(language),
          capabilities,
        },
      });

      transport.sendNotification('initialized', {});

      managed.status = 'ready';
      this.updateStatus(language, 'ready');
    } catch (error) {
      managed.status = 'error';
      this.updateStatus(language, 'error');
      this.workers.delete(language);
      worker.terminate();
      throw error;
    }

    return managed;
  }

  /**
   * Gracefully terminates a worker: sends shutdown, then exit, then terminates.
   */
  async terminateWorker(language: SupportedLanguage): Promise<void> {
    const managed = this.workers.get(language);
    if (!managed) {
      return;
    }

    this.clearIdleTimer(language);
    managed.status = 'shutting_down';
    this.updateStatus(language, 'shutting_down');

    try {
      await managed.transport.sendRequest('shutdown', null, 5_000);
      managed.transport.sendNotification('exit');
    } catch {
      // If shutdown fails, we still terminate
    }

    managed.transport.dispose();
    managed.worker.terminate();
    managed.status = 'terminated';
    this.updateStatus(language, 'terminated');
    this.workers.delete(language);
  }

  /**
   * Terminates all workers.
   */
  async terminateAll(): Promise<void> {
    const languages = [...this.workers.keys()];
    await Promise.all(languages.map((lang) => this.terminateWorker(lang)));
  }

  /**
   * Starts the idle timer for a language. When it fires, the worker
   * is terminated to free resources.
   */
  startIdleTimer(language: SupportedLanguage): void {
    this.clearIdleTimer(language);

    const timer = setTimeout(() => {
      this.idleTimers.delete(language);
      const managed = this.workers.get(language);
      if (managed && managed.pendingRequests.size === 0) {
        managed.status = 'idle';
        this.updateStatus(language, 'idle');
        void this.terminateWorker(language);
      }
    }, this.idleTimeoutMs);

    this.idleTimers.set(language, timer);
  }

  /**
   * Returns the managed worker for a language, or undefined.
   */
  getWorker(language: SupportedLanguage): ManagedWorker | undefined {
    return this.workers.get(language);
  }

  /**
   * Returns the number of active workers.
   */
  get activeCount(): number {
    return this.workers.size;
  }

  private clearIdleTimer(language: SupportedLanguage): void {
    const timer = this.idleTimers.get(language);
    if (timer) {
      clearTimeout(timer);
      this.idleTimers.delete(language);
    }
  }

  /**
   * Evicts the least recently used worker (oldest lastUsedAt).
   */
  private async evictLru(): Promise<void> {
    let oldest: ManagedWorker | null = null;

    for (const managed of this.workers.values()) {
      if (!oldest || managed.lastUsedAt < oldest.lastUsedAt) {
        oldest = managed;
      }
    }

    if (oldest) {
      await this.terminateWorker(oldest.language);
    }
  }

  private handleWorkerError(
    language: SupportedLanguage,
    _event: ErrorEvent,
  ): void {
    const managed = this.workers.get(language);
    if (!managed) {
      return;
    }

    managed.status = 'error';
    this.updateStatus(language, 'error');

    // Reject all pending requests
    managed.transport.dispose();
    managed.worker.terminate();
    this.clearIdleTimer(language);
    this.workers.delete(language);
  }

  private updateStatus(language: SupportedLanguage, status: WorkerStatus): void {
    if (this.onStatusChange) {
      this.onStatusChange(language, status);
    }
  }
}

function defaultWorkerFactory(language: SupportedLanguage): Worker {
  const wasmPath = getWasmPath(language);
  return new Worker(wasmPath, { type: 'module' });
}
