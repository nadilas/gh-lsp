import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorkerPool } from '../../../src/background/worker-pool';
import type { SupportedLanguage, WorkerStatus } from '../../../src/shared/types';

// Mock Worker
class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();

  // Simulate a response to a postMessage (resolve LSP initialize)
  simulateResponse(data: unknown): void {
    if (this.onmessage) {
      this.onmessage({ data } as MessageEvent);
    }
  }

  simulateError(message: string): void {
    if (this.onerror) {
      this.onerror({ message } as ErrorEvent);
    }
  }
}

function createMockWorkerFactory(): {
  factory: (lang: SupportedLanguage) => Worker;
  workers: MockWorker[];
} {
  const workers: MockWorker[] = [];
  const factory = () => {
    const w = new MockWorker();
    workers.push(w);

    // Auto-respond to initialize and shutdown requests
    w.postMessage.mockImplementation((msg: unknown) => {
      const m = msg as Record<string, unknown>;
      if ('id' in m && (m['method'] === 'initialize' || m['method'] === 'shutdown')) {
        queueMicrotask(() => {
          w.simulateResponse({
            jsonrpc: '2.0',
            id: m['id'],
            result: m['method'] === 'initialize' ? { capabilities: {} } : null,
          });
        });
      }
    });

    return w as unknown as Worker;
  };
  return { factory, workers };
}

describe('WorkerPool', () => {
  let pool: WorkerPool;
  let mockFactory: ReturnType<typeof createMockWorkerFactory>;
  let statusChanges: Array<{ language: SupportedLanguage; status: WorkerStatus }>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockFactory = createMockWorkerFactory();
    pool = new WorkerPool(2, 60_000, mockFactory.factory);
    statusChanges = [];
    pool.setStatusCallback((language, status) => {
      statusChanges.push({ language, status });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getOrCreateWorker', () => {
    it('spawns a new worker for a new language', async () => {
      const managed = await pool.getOrCreateWorker('typescript');

      expect(managed).toBeDefined();
      expect(managed.language).toBe('typescript');
      expect(managed.status).toBe('ready');
      expect(mockFactory.workers).toHaveLength(1);
    });

    it('reuses existing worker for the same language', async () => {
      const first = await pool.getOrCreateWorker('typescript');
      const second = await pool.getOrCreateWorker('typescript');

      expect(first).toBe(second);
      expect(mockFactory.workers).toHaveLength(1);
    });

    it('spawns separate workers for different languages', async () => {
      const ts = await pool.getOrCreateWorker('typescript');
      const go = await pool.getOrCreateWorker('go');

      expect(ts.language).toBe('typescript');
      expect(go.language).toBe('go');
      expect(mockFactory.workers).toHaveLength(2);
    });

    it('evicts LRU worker when at max capacity', async () => {
      await pool.getOrCreateWorker('typescript');
      await pool.getOrCreateWorker('go');

      // At capacity (2). Adding python should evict typescript (oldest)
      const python = await pool.getOrCreateWorker('python');

      expect(python.language).toBe('python');
      expect(pool.activeCount).toBe(2);
      expect(pool.getWorker('typescript')).toBeUndefined();
      expect(pool.getWorker('go')).toBeDefined();
      expect(pool.getWorker('python')).toBeDefined();
    });

    it('emits status changes during spawn', async () => {
      await pool.getOrCreateWorker('typescript');

      const statuses = statusChanges
        .filter((s) => s.language === 'typescript')
        .map((s) => s.status);

      expect(statuses).toContain('loading');
      expect(statuses).toContain('initializing');
      expect(statuses).toContain('ready');
    });
  });

  describe('terminateWorker', () => {
    it('terminates a worker and removes it from the pool', async () => {
      const managed = await pool.getOrCreateWorker('typescript');

      await pool.terminateWorker('typescript');

      expect(pool.getWorker('typescript')).toBeUndefined();
      expect(pool.activeCount).toBe(0);
      expect(managed.status).toBe('terminated');
    });

    it('is a no-op for non-existent workers', async () => {
      await pool.terminateWorker('rust');
      // Should not throw
    });
  });

  describe('terminateAll', () => {
    it('terminates all workers', async () => {
      await pool.getOrCreateWorker('typescript');
      await pool.getOrCreateWorker('go');

      await pool.terminateAll();

      expect(pool.activeCount).toBe(0);
    });
  });

  describe('idle timeout', () => {
    it('terminates worker after idle timeout', async () => {
      await pool.getOrCreateWorker('typescript');

      pool.startIdleTimer('typescript');

      // Advance past idle timeout
      await vi.advanceTimersByTimeAsync(60_001);

      expect(pool.getWorker('typescript')).toBeUndefined();
    });

    it('cancels idle timer when worker is reused', async () => {
      await pool.getOrCreateWorker('typescript');

      pool.startIdleTimer('typescript');

      // Reuse before timeout
      await vi.advanceTimersByTimeAsync(30_000);
      await pool.getOrCreateWorker('typescript');

      // Advance past original timeout
      await vi.advanceTimersByTimeAsync(31_000);

      // Worker should still be alive (timer was cleared on reuse)
      expect(pool.getWorker('typescript')).toBeDefined();
    });
  });

  describe('crash recovery', () => {
    it('removes crashed worker from pool', async () => {
      await pool.getOrCreateWorker('typescript');

      const worker = mockFactory.workers[0]!;
      worker.simulateError('Worker crashed!');

      expect(pool.getWorker('typescript')).toBeUndefined();
      expect(pool.activeCount).toBe(0);
    });

    it('allows respawning after crash', async () => {
      await pool.getOrCreateWorker('typescript');

      mockFactory.workers[0]!.simulateError('Worker crashed!');

      // Should be able to create a new worker
      const newManaged = await pool.getOrCreateWorker('typescript');
      expect(newManaged.status).toBe('ready');
      expect(mockFactory.workers).toHaveLength(2);
    });

    it('emits error status on crash', async () => {
      await pool.getOrCreateWorker('typescript');
      statusChanges = [];

      mockFactory.workers[0]!.simulateError('Crash!');

      expect(statusChanges).toContainEqual({
        language: 'typescript',
        status: 'error',
      });
    });
  });

  describe('spawn failure recovery', () => {
    it('cleans up and re-throws when LSP initialize fails', async () => {
      // Override the factory to create a worker that rejects initialize
      const failFactory = createMockWorkerFactory();
      const failPool = new WorkerPool(2, 60_000, failFactory.factory);

      // Override postMessage to NOT auto-respond (simulate a timeout or error)
      failFactory.factory = () => {
        const w = new MockWorker();
        failFactory.workers.push(w);
        w.postMessage.mockImplementation((msg: unknown) => {
          const m = msg as Record<string, unknown>;
          if ('id' in m && m['method'] === 'initialize') {
            queueMicrotask(() => {
              w.simulateResponse({
                jsonrpc: '2.0',
                id: m['id'],
                error: { code: -32603, message: 'Init failed' },
              });
            });
          }
        });
        return w as unknown as Worker;
      };
      const pool2 = new WorkerPool(2, 60_000, failFactory.factory);

      await expect(pool2.getOrCreateWorker('typescript')).rejects.toBeDefined();
      expect(pool2.activeCount).toBe(0);
      expect(pool2.getWorker('typescript')).toBeUndefined();
    });
  });

  describe('idle timer with pending requests', () => {
    it('does not terminate worker with pending requests', async () => {
      const managed = await pool.getOrCreateWorker('typescript');
      managed.pendingRequests.add('req-1');

      pool.startIdleTimer('typescript');

      await vi.advanceTimersByTimeAsync(60_001);

      // Worker should still exist because it has pending requests
      expect(pool.getWorker('typescript')).toBeDefined();
    });
  });

  describe('shutdown failure during terminate', () => {
    it('still terminates worker even when shutdown request fails', async () => {
      // Create a worker factory that rejects shutdown
      const factory2 = createMockWorkerFactory();
      // Override to reject shutdown
      const origFactory = factory2.factory;
      factory2.factory = (...args: Parameters<typeof origFactory>) => {
        const w = origFactory(...args) as unknown as MockWorker;
        const origPostMessage = w.postMessage;
        w.postMessage = vi.fn((msg: unknown) => {
          const m = msg as Record<string, unknown>;
          if ('id' in m && m['method'] === 'shutdown') {
            queueMicrotask(() => {
              w.simulateResponse({
                jsonrpc: '2.0',
                id: m['id'],
                error: { code: -32603, message: 'Shutdown failed' },
              });
            });
          } else {
            origPostMessage(msg);
          }
        });
        return w as unknown as Worker;
      };
      const pool2 = new WorkerPool(2, 60_000, factory2.factory);
      await pool2.getOrCreateWorker('typescript');

      // Should not throw
      await pool2.terminateWorker('typescript');
      expect(pool2.getWorker('typescript')).toBeUndefined();
      expect(pool2.activeCount).toBe(0);
    });
  });

  describe('activeCount', () => {
    it('returns 0 for empty pool', () => {
      expect(pool.activeCount).toBe(0);
    });

    it('reflects number of active workers', async () => {
      await pool.getOrCreateWorker('typescript');
      expect(pool.activeCount).toBe(1);

      await pool.getOrCreateWorker('go');
      expect(pool.activeCount).toBe(2);
    });
  });

  describe('LRU eviction order', () => {
    it('evicts the oldest worker when all are idle', async () => {
      vi.setSystemTime(1000);
      await pool.getOrCreateWorker('typescript');

      vi.setSystemTime(2000);
      await pool.getOrCreateWorker('go');

      // TS is oldest. Adding python evicts TS.
      vi.setSystemTime(3000);
      await pool.getOrCreateWorker('python');

      expect(pool.getWorker('typescript')).toBeUndefined();
      expect(pool.getWorker('go')).toBeDefined();
      expect(pool.getWorker('python')).toBeDefined();
    });

    it('evicts the least recently accessed worker', async () => {
      vi.setSystemTime(1000);
      await pool.getOrCreateWorker('typescript');

      vi.setSystemTime(2000);
      await pool.getOrCreateWorker('go');

      // Access typescript to make it more recent
      vi.setSystemTime(3000);
      await pool.getOrCreateWorker('typescript');

      // Adding python should evict go (now oldest access)
      vi.setSystemTime(4000);
      await pool.getOrCreateWorker('python');

      expect(pool.getWorker('go')).toBeUndefined();
      expect(pool.getWorker('typescript')).toBeDefined();
      expect(pool.getWorker('python')).toBeDefined();
    });
  });
});
