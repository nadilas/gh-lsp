import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ExtensionSettings } from '../../../src/shared/types';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const syncStore: Record<string, unknown> = {};
const localStore: Record<string, unknown> = {};
const listeners: {
  onMessage: Array<
    (
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ) => boolean
  >;
  onCommand: Array<(command: string) => void>;
  onChanged: Array<
    (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => void
  >;
} = {
  onMessage: [],
  onCommand: [],
  onChanged: [],
};

const tabsSendMessage = vi.fn(async () => undefined);
const defaultTabs = [{ id: 1 }, { id: 2 }];
const tabsQuery = vi.fn(
  (_query: unknown, callback?: (tabs: { id?: number }[]) => void) => {
    if (callback) {
      callback(defaultTabs);
      return undefined;
    }
    return Promise.resolve(defaultTabs);
  },
);

const chromeMock = {
  runtime: {
    onMessage: {
      addListener: vi.fn((fn: (typeof listeners.onMessage)[0]) => {
        listeners.onMessage.push(fn);
      }),
    },
  },
  commands: {
    onCommand: {
      addListener: vi.fn((fn: (typeof listeners.onCommand)[0]) => {
        listeners.onCommand.push(fn);
      }),
    },
  },
  storage: {
    sync: {
      get: vi.fn(async (key: string) => ({ [key]: syncStore[key] })),
      set: vi.fn(async (items: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(items)) {
          syncStore[key] = value;
        }
      }),
    },
    local: {
      get: vi.fn(async (key: string) => ({ [key]: localStore[key] })),
      set: vi.fn(async (items: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(items)) {
          localStore[key] = value;
        }
      }),
    },
    onChanged: {
      addListener: vi.fn((fn: (typeof listeners.onChanged)[0]) => {
        listeners.onChanged.push(fn);
      }),
    },
  },
  tabs: {
    query: tabsQuery,
    sendMessage: tabsSendMessage,
  },
};

vi.stubGlobal('chrome', chromeMock);

vi.stubGlobal(
  'Worker',
  class MockWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    postMessage = vi.fn();
    terminate = vi.fn();
  },
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clearStores(): void {
  for (const key of Object.keys(syncStore)) delete syncStore[key];
  for (const key of Object.keys(localStore)) delete localStore[key];
}

function clearListeners(): void {
  listeners.onMessage.length = 0;
  listeners.onCommand.length = 0;
  listeners.onChanged.length = 0;
}

/** Fires a message through the listener and returns whether it signaled async (true). */
function fireMessage(message: unknown): boolean {
  const sendResponse = vi.fn();
  const sender: chrome.runtime.MessageSender = {};

  let isAsync = false;
  for (const listener of listeners.onMessage) {
    isAsync = listener(message, sender, sendResponse);
  }
  return isAsync;
}

function simulateCommand(command: string): void {
  for (const listener of listeners.onCommand) {
    listener(command);
  }
}

function simulateStorageChange(
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string,
): void {
  for (const listener of listeners.onChanged) {
    listener(changes, areaName);
  }
}

/** Wait for async microtasks and macrotasks to settle. */
async function flush(): Promise<void> {
  // Multiple ticks to let chained async work complete
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('background/index', () => {
  beforeEach(async () => {
    clearStores();
    clearListeners();
    vi.clearAllMocks();
    vi.resetModules();

    // Re-import the module to trigger top-level initialization
    await import('../../../src/background/index');
    // Let the async initialization complete
    await flush();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initialization', () => {
    it('registers chrome.runtime.onMessage listener', () => {
      expect(chromeMock.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
      expect(listeners.onMessage).toHaveLength(1);
    });

    it('registers chrome.commands.onCommand listener', () => {
      expect(chromeMock.commands.onCommand.addListener).toHaveBeenCalledTimes(1);
      expect(listeners.onCommand).toHaveLength(1);
    });

    it('registers chrome.storage.onChanged listener', () => {
      expect(chromeMock.storage.onChanged.addListener).toHaveBeenCalledTimes(1);
      expect(listeners.onChanged).toHaveLength(1);
    });

    it('reads settings during initialization', () => {
      expect(chromeMock.storage.sync.get).toHaveBeenCalledWith(
        'gh-lsp-settings',
      );
    });
  });

  describe('message dispatch', () => {
    it('returns false for non-ExtensionMessage values', () => {
      const result = fireMessage({ foo: 'bar' });
      expect(result).toBe(false);
    });

    it('returns false for messages with unknown type', () => {
      const result = fireMessage({ type: 'unknown/type' });
      expect(result).toBe(false);
    });

    it('returns true for valid extension messages (async channel)', () => {
      const result = fireMessage({
        type: 'extension/toggle',
        enabled: true,
      });
      expect(result).toBe(true);
    });

    it('handles extension/toggle message', async () => {
      fireMessage({
        type: 'extension/toggle',
        enabled: false,
      });

      await flush();

      expect(chromeMock.storage.sync.set).toHaveBeenCalled();
      expect(tabsQuery).toHaveBeenCalled();
    });

    it('handles page/navigated message without error', async () => {
      fireMessage({
        type: 'page/navigated',
        newContext: null,
      });

      await flush();
      // Should not throw or produce unexpected side effects
    });
  });

  describe('extension toggle', () => {
    it('saves enabled=false to settings', async () => {
      fireMessage({
        type: 'extension/toggle',
        enabled: false,
      });

      await flush();

      const stored = syncStore['gh-lsp-settings'] as ExtensionSettings;
      expect(stored.enabled).toBe(false);
    });

    it('saves enabled=true to settings', async () => {
      // Start disabled
      syncStore['gh-lsp-settings'] = { enabled: false };

      fireMessage({
        type: 'extension/toggle',
        enabled: true,
      });

      await flush();

      const stored = syncStore['gh-lsp-settings'] as ExtensionSettings;
      expect(stored.enabled).toBe(true);
    });

    it('broadcasts toggle to GitHub tabs', async () => {
      tabsSendMessage.mockClear();

      fireMessage({
        type: 'extension/toggle',
        enabled: true,
      });

      await flush();

      expect(tabsQuery).toHaveBeenCalledWith(
        { url: 'https://github.com/*' },
        expect.any(Function),
      );
      expect(tabsSendMessage).toHaveBeenCalledWith(1, {
        type: 'extension/toggle',
        enabled: true,
      });
      expect(tabsSendMessage).toHaveBeenCalledWith(2, {
        type: 'extension/toggle',
        enabled: true,
      });
    });
  });

  describe('keyboard commands', () => {
    it('toggle-extension toggles the enabled setting', async () => {
      simulateCommand('toggle-extension');

      await flush();

      const stored = syncStore['gh-lsp-settings'] as ExtensionSettings;
      expect(stored.enabled).toBe(false);
    });

    it('toggle-sidebar switches displayMode from popover to sidebar', async () => {
      simulateCommand('toggle-sidebar');

      await flush();

      const stored = syncStore['gh-lsp-settings'] as ExtensionSettings;
      expect(stored.displayMode).toBe('sidebar');
    });

    it('toggle-sidebar cycles back to popover', async () => {
      syncStore['gh-lsp-settings'] = { displayMode: 'sidebar' };

      simulateCommand('toggle-sidebar');

      await flush();

      const stored = syncStore['gh-lsp-settings'] as ExtensionSettings;
      expect(stored.displayMode).toBe('popover');
    });

    it('pin-popover forwards command to the active tab', async () => {
      tabsSendMessage.mockClear();

      simulateCommand('pin-popover');

      await flush();

      expect(tabsQuery).toHaveBeenCalledWith({
        active: true,
        currentWindow: true,
      });
      expect(tabsSendMessage).toHaveBeenCalledWith(1, {
        command: 'pin-popover',
      });
    });

    it('pin-popover handles no active tab gracefully', async () => {
      tabsQuery.mockImplementationOnce(
        (_query: unknown, callback?: (tabs: { id?: number }[]) => void) => {
          if (callback) {
            callback([]);
            return undefined;
          }
          return Promise.resolve([]);
        },
      );
      tabsSendMessage.mockClear();

      simulateCommand('pin-popover');

      await flush();

      expect(tabsSendMessage).not.toHaveBeenCalledWith(
        expect.anything(),
        { command: 'pin-popover' },
      );
    });

    it('unknown command does not throw', () => {
      expect(() => simulateCommand('something-else')).not.toThrow();
    });
  });

  describe('settings change propagation', () => {
    it('broadcasts settings diff to GitHub tabs on change', async () => {
      tabsSendMessage.mockClear();

      simulateStorageChange(
        {
          'gh-lsp-settings': {
            oldValue: { displayMode: 'popover', enabled: true },
            newValue: { displayMode: 'sidebar', enabled: true },
          },
        },
        'sync',
      );

      await flush();

      const settingsCall = tabsSendMessage.mock.calls.find(
        (call: unknown[]) =>
          ((call as unknown[])[1] as { type: string }).type ===
          'settings/changed',
      );
      expect(settingsCall).toBeDefined();

      const msg = (settingsCall as unknown[])[1] as {
        type: string;
        changes: Partial<ExtensionSettings>;
      };
      expect(msg.changes.displayMode).toBe('sidebar');
    });

    it('ignores changes from non-sync area', () => {
      tabsSendMessage.mockClear();

      simulateStorageChange(
        {
          'gh-lsp-settings': {
            oldValue: { enabled: true },
            newValue: { enabled: false },
          },
        },
        'local',
      );

      expect(tabsSendMessage).not.toHaveBeenCalled();
    });

    it('ignores changes to unrelated storage keys', () => {
      tabsSendMessage.mockClear();

      simulateStorageChange(
        {
          'other-key': {
            oldValue: 'old',
            newValue: 'new',
          },
        },
        'sync',
      );

      expect(tabsSendMessage).not.toHaveBeenCalled();
    });

    it('does not broadcast when no fields actually changed', () => {
      tabsSendMessage.mockClear();

      const sameSettings = { displayMode: 'popover', enabled: true };
      simulateStorageChange(
        {
          'gh-lsp-settings': {
            oldValue: sameSettings,
            newValue: sameSettings,
          },
        },
        'sync',
      );

      expect(tabsSendMessage).not.toHaveBeenCalled();
    });

    it('handles missing oldValue gracefully', async () => {
      tabsSendMessage.mockClear();

      simulateStorageChange(
        {
          'gh-lsp-settings': {
            oldValue: undefined,
            newValue: { displayMode: 'sidebar', enabled: true },
          },
        },
        'sync',
      );

      await flush();

      const settingsCall = tabsSendMessage.mock.calls.find(
        (call: unknown[]) =>
          ((call as unknown[])[1] as { type: string }).type ===
          'settings/changed',
      );
      expect(settingsCall).toBeDefined();
    });
  });

  describe('tab messaging', () => {
    it('broadcasts to all GitHub tabs', async () => {
      tabsSendMessage.mockClear();

      fireMessage({
        type: 'extension/toggle',
        enabled: true,
      });

      await flush();

      expect(tabsSendMessage).toHaveBeenCalledTimes(2);
    });

    it('handles sendMessage rejection gracefully', async () => {
      tabsSendMessage.mockRejectedValue(new Error('No listener'));

      fireMessage({
        type: 'extension/toggle',
        enabled: true,
      });

      // Should not throw
      await flush();
    });

    it('skips tabs without an id', async () => {
      tabsQuery.mockImplementation(
        (_query: unknown, callback?: (tabs: { id?: number }[]) => void) => {
          const tabs = [{ id: undefined }, { id: 3 }];
          if (callback) {
            callback(tabs);
            return undefined;
          }
          return Promise.resolve(tabs);
        },
      );
      tabsSendMessage.mockClear();

      fireMessage({
        type: 'extension/toggle',
        enabled: true,
      });

      await flush();

      expect(tabsSendMessage).toHaveBeenCalledTimes(1);
      expect(tabsSendMessage).toHaveBeenCalledWith(3, expect.any(Object));
    });
  });
});
