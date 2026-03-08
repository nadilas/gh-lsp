import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  getSettings,
  saveSettings,
  getSecureSettings,
  saveSecureSettings,
} from '../../../src/shared/settings';
import type { ExtensionSettings } from '../../../src/shared/types';

// Mock chrome.storage API
const syncStore: Record<string, unknown> = {};
const localStore: Record<string, unknown> = {};

const chromeMock = {
  storage: {
    sync: {
      get: vi.fn(async (key: string) => {
        return { [key]: syncStore[key] };
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(items)) {
          syncStore[key] = value;
        }
      }),
    },
    local: {
      get: vi.fn(async (key: string) => {
        return { [key]: localStore[key] };
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(items)) {
          localStore[key] = value;
        }
      }),
    },
  },
};

// Install mock globally
vi.stubGlobal('chrome', chromeMock);

function clearStores(): void {
  for (const key of Object.keys(syncStore)) {
    delete syncStore[key];
  }
  for (const key of Object.keys(localStore)) {
    delete localStore[key];
  }
}

beforeEach(() => {
  clearStores();
  vi.clearAllMocks();
});

describe('DEFAULT_SETTINGS', () => {
  it('has all required fields with correct defaults', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      displayMode: 'popover',
      sidebarPosition: 'right',
      hoverDebounceMs: 300,
      enabledLanguages: ['typescript', 'javascript', 'go', 'rust', 'python'],
      cacheTimeoutMinutes: 10,
      workerIdleTimeoutMinutes: 5,
      maxConcurrentWorkers: 4,
      theme: 'auto',
      showLoadingIndicator: true,
      keyboardShortcutToggle: 'Alt+Shift+L',
      keyboardShortcutSidebar: 'Alt+Shift+S',
      keyboardShortcutPinPopover: 'Alt+Shift+P',
      enabled: true,
    });
  });

  it('satisfies ExtensionSettings type', () => {
    const settings: ExtensionSettings = DEFAULT_SETTINGS;
    expect(settings).toBeDefined();
  });
});

describe('getSettings', () => {
  it('returns DEFAULT_SETTINGS when nothing is stored', async () => {
    const settings = await getSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  it('returns a copy, not a reference to DEFAULT_SETTINGS', async () => {
    const settings = await getSettings();
    expect(settings).not.toBe(DEFAULT_SETTINGS);
  });

  it('merges stored values over defaults', async () => {
    syncStore['gh-lsp-settings'] = {
      displayMode: 'sidebar',
      hoverDebounceMs: 500,
    };

    const settings = await getSettings();
    expect(settings.displayMode).toBe('sidebar');
    expect(settings.hoverDebounceMs).toBe(500);
    // Non-stored fields come from defaults
    expect(settings.sidebarPosition).toBe('right');
    expect(settings.theme).toBe('auto');
    expect(settings.enabled).toBe(true);
    expect(settings.enabledLanguages).toEqual([
      'typescript',
      'javascript',
      'go',
      'rust',
      'python',
    ]);
  });

  it('handles schema migration — new fields get defaults', async () => {
    // Simulate an older storage version that lacks some fields
    syncStore['gh-lsp-settings'] = {
      displayMode: 'popover',
      sidebarPosition: 'left',
    };

    const settings = await getSettings();
    // Stored value preserved
    expect(settings.sidebarPosition).toBe('left');
    // New fields get defaults
    expect(settings.maxConcurrentWorkers).toBe(4);
    expect(settings.showLoadingIndicator).toBe(true);
    expect(settings.keyboardShortcutToggle).toBe('Alt+Shift+L');
  });

  it('reads from chrome.storage.sync', async () => {
    await getSettings();
    expect(chromeMock.storage.sync.get).toHaveBeenCalledWith(
      'gh-lsp-settings',
    );
  });
});

describe('saveSettings', () => {
  it('writes only changed keys merged with current settings', async () => {
    await saveSettings({ displayMode: 'sidebar' });

    expect(chromeMock.storage.sync.set).toHaveBeenCalledTimes(1);
    const saved = syncStore['gh-lsp-settings'] as ExtensionSettings;
    expect(saved.displayMode).toBe('sidebar');
    // Other fields should be defaults since nothing was stored before
    expect(saved.sidebarPosition).toBe('right');
    expect(saved.enabled).toBe(true);
  });

  it('preserves previously stored settings', async () => {
    syncStore['gh-lsp-settings'] = {
      displayMode: 'sidebar',
      hoverDebounceMs: 500,
    };

    await saveSettings({ theme: 'dark' });

    const saved = syncStore['gh-lsp-settings'] as ExtensionSettings;
    expect(saved.displayMode).toBe('sidebar');
    expect(saved.hoverDebounceMs).toBe(500);
    expect(saved.theme).toBe('dark');
  });

  it('overwrites a previously stored key', async () => {
    syncStore['gh-lsp-settings'] = { displayMode: 'sidebar' };

    await saveSettings({ displayMode: 'popover' });

    const saved = syncStore['gh-lsp-settings'] as ExtensionSettings;
    expect(saved.displayMode).toBe('popover');
  });

  it('writes to chrome.storage.sync', async () => {
    await saveSettings({ enabled: false });
    expect(chromeMock.storage.sync.set).toHaveBeenCalled();
  });
});

describe('getSecureSettings', () => {
  it('returns empty PAT when nothing is stored', async () => {
    const secure = await getSecureSettings();
    expect(secure).toEqual({ githubPat: '' });
  });

  it('returns stored PAT', async () => {
    localStore['gh-lsp-secure'] = { githubPat: 'ghp_test123' };

    const secure = await getSecureSettings();
    expect(secure.githubPat).toBe('ghp_test123');
  });

  it('reads from chrome.storage.local (not sync)', async () => {
    await getSecureSettings();
    expect(chromeMock.storage.local.get).toHaveBeenCalledWith(
      'gh-lsp-secure',
    );
    expect(chromeMock.storage.sync.get).not.toHaveBeenCalled();
  });
});

describe('saveSecureSettings', () => {
  it('stores PAT in chrome.storage.local', async () => {
    await saveSecureSettings({ githubPat: 'ghp_abc456' });

    expect(chromeMock.storage.local.set).toHaveBeenCalled();
    expect(localStore['gh-lsp-secure']).toEqual({ githubPat: 'ghp_abc456' });
  });

  it('overwrites previously stored PAT', async () => {
    localStore['gh-lsp-secure'] = { githubPat: 'ghp_old' };

    await saveSecureSettings({ githubPat: 'ghp_new' });

    expect(localStore['gh-lsp-secure']).toEqual({ githubPat: 'ghp_new' });
  });

  it('writes to chrome.storage.local (not sync)', async () => {
    await saveSecureSettings({ githubPat: 'ghp_test' });
    expect(chromeMock.storage.local.set).toHaveBeenCalled();
    expect(chromeMock.storage.sync.set).not.toHaveBeenCalled();
  });
});

describe('storage isolation', () => {
  it('settings and secure settings use separate storage areas', async () => {
    await saveSettings({ displayMode: 'sidebar' });
    await saveSecureSettings({ githubPat: 'ghp_secret' });

    // Settings in sync
    expect(syncStore['gh-lsp-settings']).toBeDefined();
    expect(syncStore['gh-lsp-secure']).toBeUndefined();

    // Secure in local
    expect(localStore['gh-lsp-secure']).toBeDefined();
    expect(localStore['gh-lsp-settings']).toBeUndefined();
  });
});
