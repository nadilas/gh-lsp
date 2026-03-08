import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { h, render } from 'preact';
import { Options, type OptionsProps } from '../../../../src/pages/options/main';
import type { ExtensionSettings, SecureSettings } from '../../../../src/shared/types';
import { DEFAULT_SETTINGS } from '../../../../src/shared/settings';

// ─── Chrome API Mock ─────────────────────────────────────────────────────────

function setupChromeMock(): void {
  const chromeMock = {
    runtime: {
      onMessage: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
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

// ─── Settings Mock ───────────────────────────────────────────────────────────

vi.mock('../../../../src/shared/settings', async () => {
  const actual = await vi.importActual<typeof import('../../../../src/shared/settings')>(
    '../../../../src/shared/settings',
  );
  return {
    ...actual,
    getSettings: vi.fn(),
    saveSettings: vi.fn(),
    getSecureSettings: vi.fn(),
    saveSecureSettings: vi.fn(),
  };
});

vi.mock('../../../../src/pages/options/options.css', () => ({}));

import {
  getSettings,
  saveSettings,
  getSecureSettings,
  saveSecureSettings,
} from '../../../../src/shared/settings';

const mockGetSettings = vi.mocked(getSettings);
const mockSaveSettings = vi.mocked(saveSettings);
const mockGetSecureSettings = vi.mocked(getSecureSettings);
const mockSaveSecureSettings = vi.mocked(saveSecureSettings);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createSettings(overrides?: Partial<ExtensionSettings>): ExtensionSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

function createSecureSettings(
  overrides?: Partial<SecureSettings>,
): SecureSettings {
  return { githubPat: '', ...overrides };
}

async function renderOptions(
  props: OptionsProps = {},
  settings?: Partial<ExtensionSettings>,
  secure?: Partial<SecureSettings>,
): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);

  mockGetSettings.mockResolvedValue(createSettings(settings));
  mockSaveSettings.mockResolvedValue(undefined);
  mockGetSecureSettings.mockResolvedValue(createSecureSettings(secure));
  mockSaveSecureSettings.mockResolvedValue(undefined);

  render(h(Options, props), container);

  // Wait for loading to complete
  await vi.waitFor(() => {
    const loading = container.querySelector('.gh-lsp-options__loading');
    if (loading) throw new Error('Still loading');
  });

  return container;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Options', () => {
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

  // ─── Loading & Error States ──────────────────────────────────────────

  it('shows loading state initially', () => {
    mockGetSettings.mockReturnValue(new Promise(() => {}));
    mockGetSecureSettings.mockReturnValue(new Promise(() => {}));

    container = document.createElement('div');
    document.body.appendChild(container);
    render(h(Options, {}), container);

    const loading = container.querySelector('.gh-lsp-options__loading');
    expect(loading).not.toBeNull();
    expect(loading?.textContent).toBe('Loading settings...');
  });

  it('shows error state when settings fail to load', async () => {
    mockGetSettings.mockRejectedValue(new Error('storage error'));
    mockGetSecureSettings.mockResolvedValue(createSecureSettings());

    container = document.createElement('div');
    document.body.appendChild(container);
    render(h(Options, {}), container);

    await vi.waitFor(() => {
      const error = container.querySelector('.gh-lsp-options__error');
      if (!error) throw new Error('No error element');
    });

    const error = container.querySelector('.gh-lsp-options__error');
    expect(error?.textContent).toBe('Failed to load settings');
  });

  // ─── Page Structure ────────────────────────────────────────────────────

  it('renders the page title', async () => {
    container = await renderOptions();
    const title = container.querySelector('.gh-lsp-options__title');
    expect(title?.textContent).toBe('gh-lsp Settings');
  });

  it('renders all sections', async () => {
    container = await renderOptions();
    const sections = container.querySelectorAll('.gh-lsp-options__section');
    expect(sections.length).toBe(6); // Display, Languages, Auth, Performance, Theme, About
  });

  it('renders section titles', async () => {
    container = await renderOptions();
    const titles = container.querySelectorAll('.gh-lsp-options__section-title');
    const titleTexts = Array.from(titles).map((t) => t.textContent);
    expect(titleTexts).toEqual([
      'Display',
      'Languages',
      'Authentication',
      'Performance',
      'Theme',
      'About',
    ]);
  });

  // ─── Display Section ──────────────────────────────────────────────────

  it('shows popover radio as checked by default', async () => {
    container = await renderOptions({}, { displayMode: 'popover' });

    const popoverRadio = container.querySelector(
      'input[name="displayMode"][value="popover"]',
    ) as HTMLInputElement;
    const sidebarRadio = container.querySelector(
      'input[name="displayMode"][value="sidebar"]',
    ) as HTMLInputElement;

    expect(popoverRadio.checked).toBe(true);
    expect(sidebarRadio.checked).toBe(false);
  });

  it('shows sidebar radio as checked when configured', async () => {
    container = await renderOptions({}, { displayMode: 'sidebar' });

    const sidebarRadio = container.querySelector(
      'input[name="displayMode"][value="sidebar"]',
    ) as HTMLInputElement;
    expect(sidebarRadio.checked).toBe(true);
  });

  it('saves display mode change', async () => {
    container = await renderOptions({}, { displayMode: 'popover' });

    const sidebarRadio = container.querySelector(
      'input[name="displayMode"][value="sidebar"]',
    ) as HTMLInputElement;
    sidebarRadio.click();

    await vi.waitFor(() => {
      expect(mockSaveSettings).toHaveBeenCalledWith({
        displayMode: 'sidebar',
      });
    });
  });

  it('shows sidebar position dropdown', async () => {
    container = await renderOptions({}, { sidebarPosition: 'right' });

    const select = container.querySelector(
      '.gh-lsp-options__select',
    ) as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.value).toBe('right');

    const options = select.querySelectorAll('option');
    expect(options.length).toBe(4);
  });

  it('saves sidebar position change', async () => {
    container = await renderOptions({}, { sidebarPosition: 'right' });

    const select = container.querySelector(
      '.gh-lsp-options__select',
    ) as HTMLSelectElement;

    // Simulate selection change
    select.value = 'left';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    await vi.waitFor(() => {
      expect(mockSaveSettings).toHaveBeenCalledWith({
        sidebarPosition: 'left',
      });
    });
  });

  // ─── Languages Section ─────────────────────────────────────────────────

  it('shows all language checkboxes', async () => {
    container = await renderOptions();

    const checkboxes = container.querySelectorAll(
      '.gh-lsp-options__checkbox-label',
    );
    expect(checkboxes.length).toBe(5);

    const labels = Array.from(checkboxes).map((cb) => cb.textContent?.trim());
    expect(labels).toEqual([
      'TypeScript',
      'JavaScript',
      'Go',
      'Rust',
      'Python',
    ]);
  });

  it('shows all languages as enabled by default', async () => {
    container = await renderOptions();

    const checkboxes = container.querySelectorAll(
      '.gh-lsp-options__checkbox-label input',
    ) as NodeListOf<HTMLInputElement>;

    for (const cb of checkboxes) {
      expect(cb.checked).toBe(true);
    }
  });

  it('unchecks disabled language', async () => {
    container = await renderOptions(
      {},
      { enabledLanguages: ['typescript', 'javascript'] },
    );

    const checkboxes = container.querySelectorAll(
      '.gh-lsp-options__checkbox-label input',
    ) as NodeListOf<HTMLInputElement>;

    // TS and JS checked, Go, Rust, Python unchecked
    expect(checkboxes[0]!.checked).toBe(true); // TypeScript
    expect(checkboxes[1]!.checked).toBe(true); // JavaScript
    expect(checkboxes[2]!.checked).toBe(false); // Go
    expect(checkboxes[3]!.checked).toBe(false); // Rust
    expect(checkboxes[4]!.checked).toBe(false); // Python
  });

  it('saves language toggle', async () => {
    container = await renderOptions();

    // Uncheck TypeScript (first checkbox)
    const tsCheckbox = container.querySelector(
      '.gh-lsp-options__checkbox-label input',
    ) as HTMLInputElement;
    tsCheckbox.click();

    await vi.waitFor(() => {
      expect(mockSaveSettings).toHaveBeenCalledWith({
        enabledLanguages: ['javascript', 'go', 'rust', 'python'],
      });
    });
  });

  // ─── Authentication Section ────────────────────────────────────────────

  it('shows PAT input field', async () => {
    container = await renderOptions();

    const input = container.querySelector(
      'input[aria-label="GitHub Personal Access Token"]',
    ) as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.type).toBe('password'); // hidden by default
  });

  it('populates PAT from saved secure settings', async () => {
    container = await renderOptions({}, {}, { githubPat: 'ghp_test1234' });

    const input = container.querySelector(
      'input[aria-label="GitHub Personal Access Token"]',
    ) as HTMLInputElement;
    expect(input.value).toBe('ghp_test1234');
  });

  it('shows masked PAT when saved', async () => {
    container = await renderOptions(
      {},
      {},
      { githubPat: 'ghp_abc123456789xyz' },
    );

    const masked = container.querySelector('.gh-lsp-options__pat-masked');
    expect(masked).not.toBeNull();
    expect(masked?.textContent).toContain('Saved:');
    expect(masked?.textContent).toContain('ghp_');
    expect(masked?.textContent).toContain('*');
  });

  it('toggles PAT visibility', async () => {
    container = await renderOptions({}, {}, { githubPat: 'ghp_test' });

    const input = container.querySelector(
      'input[aria-label="GitHub Personal Access Token"]',
    ) as HTMLInputElement;
    const showBtn = container.querySelector(
      'button[aria-label="Show token"]',
    ) as HTMLButtonElement;

    expect(input.type).toBe('password');
    showBtn.click();

    await vi.waitFor(() => {
      expect(input.type).toBe('text');
    });
  });

  it('saves PAT via Save button', async () => {
    // Pre-populate PAT from secure settings so patInput state is already set
    container = await renderOptions({}, {}, { githubPat: 'ghp_existing_token' });

    // Click Save — it should save the current patInput state
    const saveBtn = Array.from(
      container.querySelectorAll('.gh-lsp-options__btn'),
    ).find((btn) => btn.textContent === 'Save') as HTMLButtonElement;
    saveBtn.click();

    await vi.waitFor(() => {
      expect(mockSaveSecureSettings).toHaveBeenCalledWith({
        githubPat: 'ghp_existing_token',
      });
    });
  });

  it('validates PAT successfully', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ login: 'testuser' }),
    });

    container = await renderOptions({ fetchFn: mockFetch }, {}, { githubPat: 'ghp_test' });

    const validateBtn = Array.from(
      container.querySelectorAll('.gh-lsp-options__btn'),
    ).find((btn) => btn.textContent === 'Validate') as HTMLButtonElement;
    validateBtn.click();

    await vi.waitFor(() => {
      const status = container.querySelector(
        '.gh-lsp-options__status--success',
      );
      if (!status) throw new Error('No success status');
    });

    const status = container.querySelector('.gh-lsp-options__status--success');
    expect(status?.textContent).toBe('Authenticated as testuser');
  });

  it('shows validation error on failed auth', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({}),
    });

    container = await renderOptions({ fetchFn: mockFetch }, {}, { githubPat: 'ghp_bad' });

    const validateBtn = Array.from(
      container.querySelectorAll('.gh-lsp-options__btn'),
    ).find((btn) => btn.textContent === 'Validate') as HTMLButtonElement;
    validateBtn.click();

    await vi.waitFor(() => {
      const status = container.querySelector('.gh-lsp-options__status--error');
      if (!status) throw new Error('No error status');
    });

    const status = container.querySelector('.gh-lsp-options__status--error');
    expect(status?.textContent).toBe('Authentication failed (401)');
  });

  it('shows error when validating with empty token', async () => {
    container = await renderOptions();

    const validateBtn = Array.from(
      container.querySelectorAll('.gh-lsp-options__btn'),
    ).find((btn) => btn.textContent === 'Validate') as HTMLButtonElement;
    validateBtn.click();

    await vi.waitFor(() => {
      const status = container.querySelector('.gh-lsp-options__status--error');
      if (!status) throw new Error('No error status');
    });

    const status = container.querySelector('.gh-lsp-options__status--error');
    expect(status?.textContent).toBe('No token provided');
  });

  it('handles network error during PAT validation', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('network'));

    container = await renderOptions({ fetchFn: mockFetch }, {}, { githubPat: 'ghp_test' });

    const validateBtn = Array.from(
      container.querySelectorAll('.gh-lsp-options__btn'),
    ).find((btn) => btn.textContent === 'Validate') as HTMLButtonElement;
    validateBtn.click();

    await vi.waitFor(() => {
      const status = container.querySelector('.gh-lsp-options__status--error');
      if (!status) throw new Error('No error status');
    });

    const status = container.querySelector('.gh-lsp-options__status--error');
    expect(status?.textContent).toBe('Network error during validation');
  });

  // ─── Performance Section ───────────────────────────────────────────────

  it('renders debounce slider with correct value', async () => {
    container = await renderOptions({}, { hoverDebounceMs: 300 });

    const slider = container.querySelector(
      'input[aria-label="Hover debounce"]',
    ) as HTMLInputElement;
    expect(slider).not.toBeNull();
    expect(slider.value).toBe('300');
    expect(slider.min).toBe('100');
    expect(slider.max).toBe('1000');
  });

  it('renders cache TTL slider', async () => {
    container = await renderOptions({}, { cacheTimeoutMinutes: 10 });

    const slider = container.querySelector(
      'input[aria-label="Cache TTL"]',
    ) as HTMLInputElement;
    expect(slider).not.toBeNull();
    expect(slider.value).toBe('10');
    expect(slider.min).toBe('1');
    expect(slider.max).toBe('60');
  });

  it('renders worker idle timeout slider', async () => {
    container = await renderOptions({}, { workerIdleTimeoutMinutes: 5 });

    const slider = container.querySelector(
      'input[aria-label="Worker idle timeout"]',
    ) as HTMLInputElement;
    expect(slider).not.toBeNull();
    expect(slider.value).toBe('5');
    expect(slider.min).toBe('1');
    expect(slider.max).toBe('30');
  });

  it('renders max workers slider', async () => {
    container = await renderOptions({}, { maxConcurrentWorkers: 4 });

    const slider = container.querySelector(
      'input[aria-label="Max concurrent workers"]',
    ) as HTMLInputElement;
    expect(slider).not.toBeNull();
    expect(slider.value).toBe('4');
    expect(slider.min).toBe('1');
    expect(slider.max).toBe('8');
  });

  it('saves debounce change', async () => {
    container = await renderOptions({}, { hoverDebounceMs: 300 });

    const slider = container.querySelector(
      'input[aria-label="Hover debounce"]',
    ) as HTMLInputElement;

    // Simulate slider change
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(slider, '500');
    slider.dispatchEvent(new Event('input', { bubbles: true }));

    await vi.waitFor(() => {
      expect(mockSaveSettings).toHaveBeenCalledWith({
        hoverDebounceMs: 500,
      });
    });
  });

  // ─── Theme Section ────────────────────────────────────────────────────

  it('shows auto theme as selected by default', async () => {
    container = await renderOptions({}, { theme: 'auto' });

    const autoRadio = container.querySelector(
      'input[name="theme"][value="auto"]',
    ) as HTMLInputElement;
    expect(autoRadio.checked).toBe(true);
  });

  it('shows three theme options', async () => {
    container = await renderOptions();

    const themeRadios = container.querySelectorAll('input[name="theme"]');
    expect(themeRadios.length).toBe(3);
  });

  it('saves theme change', async () => {
    container = await renderOptions({}, { theme: 'auto' });

    const darkRadio = container.querySelector(
      'input[name="theme"][value="dark"]',
    ) as HTMLInputElement;
    darkRadio.click();

    await vi.waitFor(() => {
      expect(mockSaveSettings).toHaveBeenCalledWith({ theme: 'dark' });
    });
  });

  // ─── About Section ────────────────────────────────────────────────────

  it('shows version number', async () => {
    container = await renderOptions();

    const aboutRows = container.querySelectorAll('.gh-lsp-options__about-row');
    expect(aboutRows[0]?.textContent).toContain('Version');
    expect(aboutRows[0]?.textContent).toContain('0.1.0');
  });

  it('shows GitHub link', async () => {
    container = await renderOptions();

    const link = container.querySelector(
      '.gh-lsp-options__about-link',
    ) as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.textContent).toBe('GitHub');
    expect(link.href).toBe('https://github.com/nadilas/gh-lsp');
    expect(link.target).toBe('_blank');
  });

  // ─── Section aria-labels ───────────────────────────────────────────────

  it('has aria-labels on sections', async () => {
    container = await renderOptions();

    const sections = container.querySelectorAll('.gh-lsp-options__section');
    const labels = Array.from(sections).map((s) =>
      s.getAttribute('aria-label'),
    );
    expect(labels).toEqual([
      'Display settings',
      'Language settings',
      'Authentication settings',
      'Performance settings',
      'Theme settings',
      'About',
    ]);
  });

  // ─── Storage sync ──────────────────────────────────────────────────────

  it('registers chrome.storage.onChanged listener', async () => {
    container = await renderOptions();
    expect(chrome.storage.onChanged.addListener).toHaveBeenCalledOnce();
  });

  it('updates settings when storage changes externally', async () => {
    container = await renderOptions({}, { displayMode: 'popover' });

    // Get the storage change listener
    const storageListener = vi.mocked(chrome.storage.onChanged.addListener)
      .mock.calls[0]![0] as (
        changes: Record<string, chrome.storage.StorageChange>,
        areaName: string,
      ) => void;

    // Simulate external settings change (e.g., from popup)
    storageListener(
      {
        'gh-lsp-settings': {
          newValue: createSettings({ displayMode: 'sidebar' }),
        },
      },
      'sync',
    );

    await vi.waitFor(() => {
      const sidebarRadio = container.querySelector(
        'input[name="displayMode"][value="sidebar"]',
      ) as HTMLInputElement;
      expect(sidebarRadio.checked).toBe(true);
    });
  });
});
