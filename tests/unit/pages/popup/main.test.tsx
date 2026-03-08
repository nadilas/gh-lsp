import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { h, render } from 'preact';
import { Popup, type PopupProps } from '../../../../src/pages/popup/main';
import type { ExtensionSettings } from '../../../../src/shared/types';
import { DEFAULT_SETTINGS } from '../../../../src/shared/settings';

// ─── Chrome API Mock ─────────────────────────────────────────────────────────

type MessageListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
) => void;

let messageListeners: MessageListener[] = [];

function setupChromeMock(): void {
  messageListeners = [];

  const chromeMock = {
    runtime: {
      onMessage: {
        addListener: vi.fn((listener: MessageListener) => {
          messageListeners.push(listener);
        }),
        removeListener: vi.fn((listener: MessageListener) => {
          messageListeners = messageListeners.filter((l) => l !== listener);
        }),
      },
      openOptionsPage: vi.fn(),
    },
    tabs: {
      query: vi.fn(),
    },
    storage: {
      sync: { get: vi.fn(), set: vi.fn() },
      local: { get: vi.fn(), set: vi.fn() },
      onChanged: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
  };

  vi.stubGlobal('chrome', chromeMock);
}

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../../../../src/shared/settings', async () => {
  const actual = await vi.importActual<typeof import('../../../../src/shared/settings')>(
    '../../../../src/shared/settings',
  );
  return {
    ...actual,
    getSettings: vi.fn(),
    saveSettings: vi.fn(),
  };
});

vi.mock('../../../../src/pages/popup/popup.css', () => ({}));

// Import the mocked functions
import { getSettings, saveSettings } from '../../../../src/shared/settings';

const mockGetSettings = vi.mocked(getSettings);
const mockSaveSettings = vi.mocked(saveSettings);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createSettings(overrides?: Partial<ExtensionSettings>): ExtensionSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

function createTabQuery(url: string): () => Promise<{ url?: string }[]> {
  return () => Promise.resolve([{ url }]);
}

function createNonGitHubTabQuery(): () => Promise<{ url?: string }[]> {
  return () => Promise.resolve([{ url: 'https://example.com/some/page' }]);
}

function createNoTabQuery(): () => Promise<{ url?: string }[]> {
  return () => Promise.resolve([]);
}

async function renderPopup(
  props: PopupProps = {},
  settings?: Partial<ExtensionSettings>,
): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);

  mockGetSettings.mockResolvedValue(createSettings(settings));
  mockSaveSettings.mockResolvedValue(undefined);

  const defaultProps: PopupProps = {
    queryActiveTab: createTabQuery(
      'https://github.com/owner/repo/blob/main/src/index.ts',
    ),
    openOptionsPage: vi.fn(),
    ...props,
  };

  render(h(Popup, defaultProps), container);

  // Flush async effects
  await vi.waitFor(() => {
    const loading = container.querySelector('.gh-lsp-popup__loading');
    if (loading) throw new Error('Still loading');
  });

  return container;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Popup', () => {
  let container: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    setupChromeMock();
  });

  afterEach(() => {
    if (container?.parentNode) {
      render(null, container);
      container.parentNode.removeChild(container);
    }
  });

  // ─── Loading & Error States ──────────────────────────────────────────────

  it('shows loading state initially', () => {
    // Don't resolve the settings promise yet
    mockGetSettings.mockReturnValue(new Promise(() => {}));

    container = document.createElement('div');
    document.body.appendChild(container);

    render(
      h(Popup, {
        queryActiveTab: createTabQuery('https://github.com/o/r/blob/main/f.ts'),
      }),
      container,
    );

    const loading = container.querySelector('.gh-lsp-popup__loading');
    expect(loading).not.toBeNull();
    expect(loading?.textContent).toBe('Loading...');
  });

  it('shows error state when settings fail to load', async () => {
    mockGetSettings.mockRejectedValue(new Error('storage error'));

    container = document.createElement('div');
    document.body.appendChild(container);

    render(
      h(Popup, {
        queryActiveTab: createTabQuery('https://github.com/o/r/blob/main/f.ts'),
      }),
      container,
    );

    await vi.waitFor(() => {
      const error = container.querySelector('.gh-lsp-popup__error');
      if (!error) throw new Error('No error element');
    });

    const error = container.querySelector('.gh-lsp-popup__error');
    expect(error?.textContent).toBe('Failed to load extension status');
  });

  // ─── Header & Title ────────────────────────────────────────────────────────

  it('renders the extension title', async () => {
    container = await renderPopup();

    const title = container.querySelector('.gh-lsp-popup__title');
    expect(title?.textContent).toBe('gh-lsp');
  });

  // ─── Toggle Switch ─────────────────────────────────────────────────────────

  it('shows enabled toggle when extension is enabled', async () => {
    container = await renderPopup({}, { enabled: true });

    const toggle = container.querySelector(
      '.gh-lsp-popup__toggle input',
    ) as HTMLInputElement;
    expect(toggle).not.toBeNull();
    expect(toggle.checked).toBe(true);
  });

  it('shows disabled toggle when extension is disabled', async () => {
    container = await renderPopup({}, { enabled: false });

    const toggle = container.querySelector(
      '.gh-lsp-popup__toggle input',
    ) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
  });

  it('toggles extension off when clicking enabled toggle', async () => {
    container = await renderPopup({}, { enabled: true });

    const toggle = container.querySelector(
      '.gh-lsp-popup__toggle input',
    ) as HTMLInputElement;
    toggle.click();

    await vi.waitFor(() => {
      expect(mockSaveSettings).toHaveBeenCalledWith({ enabled: false });
    });
  });

  it('toggles extension on when clicking disabled toggle', async () => {
    container = await renderPopup({}, { enabled: false });

    const toggle = container.querySelector(
      '.gh-lsp-popup__toggle input',
    ) as HTMLInputElement;
    toggle.click();

    await vi.waitFor(() => {
      expect(mockSaveSettings).toHaveBeenCalledWith({ enabled: true });
    });
  });

  // ─── Disabled State ────────────────────────────────────────────────────────

  it('shows disabled message when extension is disabled', async () => {
    container = await renderPopup({}, { enabled: false });

    const msg = container.querySelector('.gh-lsp-popup__disabled-message');
    expect(msg).not.toBeNull();
    expect(msg?.textContent).toBe('Extension is disabled');
  });

  // ─── Non-Code Page ─────────────────────────────────────────────────────────

  it('shows unsupported page message on non-code GitHub pages', async () => {
    container = await renderPopup({
      queryActiveTab: createTabQuery('https://github.com/owner/repo/issues'),
    });

    const msg = container.querySelector('.gh-lsp-popup__unsupported-message');
    expect(msg).not.toBeNull();
    expect(msg?.textContent).toBe(
      'Navigate to a GitHub code page to use gh-lsp',
    );
  });

  it('shows unsupported page message on non-GitHub sites', async () => {
    container = await renderPopup({
      queryActiveTab: createNonGitHubTabQuery(),
    });

    const msg = container.querySelector('.gh-lsp-popup__unsupported-message');
    expect(msg).not.toBeNull();
  });

  it('shows unsupported page message when no active tab', async () => {
    container = await renderPopup({
      queryActiveTab: createNoTabQuery(),
    });

    const msg = container.querySelector('.gh-lsp-popup__unsupported-message');
    expect(msg).not.toBeNull();
  });

  // ─── Code Page Status ──────────────────────────────────────────────────────

  it('shows detected language on a code page', async () => {
    container = await renderPopup({
      queryActiveTab: createTabQuery(
        'https://github.com/owner/repo/blob/main/src/index.ts',
      ),
    });

    const label = container.querySelector('.gh-lsp-popup__label');
    const value = container.querySelector('.gh-lsp-popup__value');
    expect(label?.textContent).toBe('Language');
    expect(value?.textContent).toBe('TypeScript');
  });

  it('detects Go language', async () => {
    container = await renderPopup({
      queryActiveTab: createTabQuery(
        'https://github.com/owner/repo/blob/main/main.go',
      ),
    });

    const values = container.querySelectorAll('.gh-lsp-popup__value');
    expect(values[0]?.textContent).toBe('Go');
  });

  it('detects Python language', async () => {
    container = await renderPopup({
      queryActiveTab: createTabQuery(
        'https://github.com/owner/repo/blob/main/app.py',
      ),
    });

    const values = container.querySelectorAll('.gh-lsp-popup__value');
    expect(values[0]?.textContent).toBe('Python');
  });

  it('detects Rust language', async () => {
    container = await renderPopup({
      queryActiveTab: createTabQuery(
        'https://github.com/owner/repo/blob/main/lib.rs',
      ),
    });

    const values = container.querySelectorAll('.gh-lsp-popup__value');
    expect(values[0]?.textContent).toBe('Rust');
  });

  // ─── Display Mode Toggle ───────────────────────────────────────────────────

  it('shows display mode as popover by default', async () => {
    container = await renderPopup({}, { displayMode: 'popover' });

    const modeBtn = container.querySelector('.gh-lsp-popup__mode-btn');
    expect(modeBtn?.textContent).toBe('Popover');
  });

  it('shows display mode as sidebar when configured', async () => {
    container = await renderPopup({}, { displayMode: 'sidebar' });

    const modeBtn = container.querySelector('.gh-lsp-popup__mode-btn');
    expect(modeBtn?.textContent).toBe('Sidebar');
  });

  it('toggles display mode from popover to sidebar', async () => {
    container = await renderPopup({}, { displayMode: 'popover' });

    const modeBtn = container.querySelector(
      '.gh-lsp-popup__mode-btn',
    ) as HTMLButtonElement;
    modeBtn.click();

    await vi.waitFor(() => {
      expect(mockSaveSettings).toHaveBeenCalledWith({
        displayMode: 'sidebar',
      });
    });
  });

  it('toggles display mode from sidebar to popover', async () => {
    container = await renderPopup({}, { displayMode: 'sidebar' });

    const modeBtn = container.querySelector(
      '.gh-lsp-popup__mode-btn',
    ) as HTMLButtonElement;
    modeBtn.click();

    await vi.waitFor(() => {
      expect(mockSaveSettings).toHaveBeenCalledWith({
        displayMode: 'popover',
      });
    });
  });

  it('has correct aria-label on display mode button', async () => {
    container = await renderPopup({}, { displayMode: 'popover' });

    const modeBtn = container.querySelector(
      '.gh-lsp-popup__mode-btn',
    ) as HTMLButtonElement;
    expect(modeBtn.getAttribute('aria-label')).toBe(
      'Switch to sidebar mode',
    );
  });

  // ─── Settings Button ───────────────────────────────────────────────────────

  it('renders settings button in footer', async () => {
    container = await renderPopup();

    const btn = container.querySelector('.gh-lsp-popup__options-btn');
    expect(btn).not.toBeNull();
    expect(btn?.textContent).toBe('Settings');
  });

  it('calls openOptionsPage when settings button is clicked', async () => {
    const openOptionsPage = vi.fn();
    container = await renderPopup({ openOptionsPage });

    const btn = container.querySelector(
      '.gh-lsp-popup__options-btn',
    ) as HTMLButtonElement;
    btn.click();

    expect(openOptionsPage).toHaveBeenCalledOnce();
  });

  // ─── PR Files Page ─────────────────────────────────────────────────────────

  it('detects PR files page as supported', async () => {
    container = await renderPopup({
      queryActiveTab: createTabQuery(
        'https://github.com/owner/repo/pull/42/files',
      ),
    });

    // PR pages have no specific language, so no Language row should appear
    // but the page IS supported so no "unsupported" message
    const unsupported = container.querySelector(
      '.gh-lsp-popup__unsupported-message',
    );
    expect(unsupported).toBeNull();
  });

  // ─── Compare Page ──────────────────────────────────────────────────────────

  it('detects compare page as supported', async () => {
    container = await renderPopup({
      queryActiveTab: createTabQuery(
        'https://github.com/owner/repo/compare/main...feature',
      ),
    });

    const unsupported = container.querySelector(
      '.gh-lsp-popup__unsupported-message',
    );
    expect(unsupported).toBeNull();
  });

  // ─── Toggle aria-label ────────────────────────────────────────────────────

  it('toggle input has aria-label', async () => {
    container = await renderPopup();

    const toggle = container.querySelector(
      '.gh-lsp-popup__toggle input',
    ) as HTMLInputElement;
    expect(toggle.getAttribute('aria-label')).toBe('Toggle extension');
  });

  // ─── Display row shows on code pages ───────────────────────────────────────

  it('shows display row on code pages', async () => {
    container = await renderPopup();

    const labels = container.querySelectorAll('.gh-lsp-popup__label');
    const labelTexts = Array.from(labels).map((l) => l.textContent);
    expect(labelTexts).toContain('Display');
  });

  // ─── No display row when disabled ──────────────────────────────────────────

  it('does not show status rows when disabled', async () => {
    container = await renderPopup({}, { enabled: false });

    const rows = container.querySelectorAll('.gh-lsp-popup__row');
    expect(rows.length).toBe(0);
  });

  // ─── Storage sync ───────────────────────────────────────────────────────

  it('registers chrome.storage.onChanged listener', async () => {
    container = await renderPopup();
    expect(chrome.storage.onChanged.addListener).toHaveBeenCalledOnce();
  });

  it('updates UI when settings change via storage', async () => {
    container = await renderPopup({}, { enabled: true, displayMode: 'popover' });

    // Get the storage change listener
    const storageListener = vi.mocked(chrome.storage.onChanged.addListener)
      .mock.calls[0][0] as (
        changes: Record<string, chrome.storage.StorageChange>,
        areaName: string,
      ) => void;

    // Simulate settings change from options page
    storageListener(
      {
        'gh-lsp-settings': {
          newValue: {
            ...createSettings({ enabled: false, displayMode: 'sidebar' }),
          },
        },
      },
      'sync',
    );

    await vi.waitFor(() => {
      const disabledMsg = container.querySelector('.gh-lsp-popup__disabled-message');
      if (!disabledMsg) throw new Error('Should show disabled message');
    });
  });

  it('ignores storage changes from non-sync area', async () => {
    container = await renderPopup({}, { enabled: true });

    const storageListener = vi.mocked(chrome.storage.onChanged.addListener)
      .mock.calls[0][0] as (
        changes: Record<string, chrome.storage.StorageChange>,
        areaName: string,
      ) => void;

    // Simulate local storage change (should be ignored)
    storageListener(
      {
        'gh-lsp-settings': {
          newValue: { ...createSettings({ enabled: false }) },
        },
      },
      'local',
    );

    // Toggle should still show enabled
    const toggle = container.querySelector(
      '.gh-lsp-popup__toggle input',
    ) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
  });
});
