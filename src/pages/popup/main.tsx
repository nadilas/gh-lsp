import { render, type FunctionComponent } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import './popup.css';
import type {
  ExtensionSettings,
  DisplayMode,
  SupportedLanguage,
  WorkerStatus,
  PopupStatus,
} from '../../shared/types';
import { getSettings, saveSettings } from '../../shared/settings';
import { isExtensionMessage } from '../../shared/messages';
import { detectPage } from '../../content/page-detector';
import browser, { type Storage } from '../../shared/browser';

// ─── Status Indicators ──────────────────────────────────────────────────────

const WORKER_STATUS_LABELS: Record<WorkerStatus, string> = {
  idle: 'Idle',
  loading: 'Loading...',
  initializing: 'Initializing...',
  ready: 'Ready',
  busy: 'Busy',
  shutting_down: 'Shutting down...',
  error: 'Error',
  terminated: 'Terminated',
};

const WORKER_STATUS_COLORS: Record<WorkerStatus, string> = {
  idle: '#8b949e',
  loading: '#d29922',
  initializing: '#d29922',
  ready: '#3fb950',
  busy: '#58a6ff',
  shutting_down: '#8b949e',
  error: '#f85149',
  terminated: '#8b949e',
};

const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  go: 'Go',
  rust: 'Rust',
  python: 'Python',
};

// ─── Popup Component ─────────────────────────────────────────────────────────

export interface PopupProps {
  /** Injected for testing; defaults to chrome.tabs.query */
  queryActiveTab?: () => Promise<{ url?: string }[]>;
  /** Injected for testing; defaults to chrome.runtime.openOptionsPage */
  openOptionsPage?: () => void;
}

export const Popup: FunctionComponent<PopupProps> = ({
  queryActiveTab,
  openOptionsPage,
}) => {
  const [settings, setSettings] = useState<ExtensionSettings | null>(null);
  const [status, setStatus] = useState<PopupStatus>({
    extensionEnabled: true,
    isOnSupportedPage: false,
    detectedLanguage: null,
    workerStatus: null,
    displayMode: 'popover',
  });
  const [loadError, setLoadError] = useState<string | null>(null);

  // Load initial state
  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        const currentSettings = await getSettings();
        if (cancelled) return;
        setSettings(currentSettings);

        // Query active tab to detect page
        const getActiveTab =
          queryActiveTab ??
          (() => browser.tabs.query({ active: true, currentWindow: true }));
        const tabs = await getActiveTab();
        if (cancelled) return;

        const activeTab = tabs[0];
        const url = activeTab?.url ?? '';
        const detection = url ? detectPage(url) : null;

        setStatus({
          extensionEnabled: currentSettings.enabled,
          isOnSupportedPage: detection !== null,
          detectedLanguage: (detection?.context.language as SupportedLanguage) || null,
          workerStatus: null,
          displayMode: currentSettings.displayMode,
        });
      } catch (err) {
        if (cancelled) return;
        setLoadError('Failed to load extension status');
        console.error('[gh-lsp] Popup load error:', err);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [queryActiveTab]);

  // Listen for worker status updates via runtime messaging
  useEffect(() => {
    const listener = (message: unknown): void => {
      if (!isExtensionMessage(message)) return;

      if (message.type === 'worker/status') {
        setStatus((prev) => ({
          ...prev,
          workerStatus: message.status,
        }));
      }
    };

    browser.runtime.onMessage.addListener(listener);
    return () => {
      browser.runtime.onMessage.removeListener(listener);
    };
  }, []);

  // Listen for settings changes via browser.storage.onChanged
  useEffect(() => {
    const storageListener = (
      changes: Record<string, Storage.StorageChange>,
      areaName: string,
    ): void => {
      if (areaName !== 'sync') return;

      const settingsChange = changes['gh-lsp-settings'];
      if (!settingsChange?.newValue) return;

      const newSettings = settingsChange.newValue as ExtensionSettings;
      setSettings(newSettings);
      setStatus((prev) => ({
        ...prev,
        extensionEnabled: newSettings.enabled,
        displayMode: newSettings.displayMode,
      }));
    };

    browser.storage.onChanged.addListener(storageListener);
    return () => {
      browser.storage.onChanged.removeListener(storageListener);
    };
  }, []);

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const handleToggleEnabled = useCallback(async () => {
    if (!settings) return;
    const newEnabled = !settings.enabled;
    await saveSettings({ enabled: newEnabled });
    setSettings((prev) => (prev ? { ...prev, enabled: newEnabled } : prev));
    setStatus((prev) => ({ ...prev, extensionEnabled: newEnabled }));
  }, [settings]);

  const handleToggleDisplayMode = useCallback(async () => {
    if (!settings) return;
    const newMode: DisplayMode =
      settings.displayMode === 'popover' ? 'sidebar' : 'popover';
    await saveSettings({ displayMode: newMode });
    setSettings((prev) => (prev ? { ...prev, displayMode: newMode } : prev));
    setStatus((prev) => ({ ...prev, displayMode: newMode }));
  }, [settings]);

  const handleOpenOptions = useCallback(() => {
    const openFn = openOptionsPage ?? (() => browser.runtime.openOptionsPage());
    openFn();
  }, [openOptionsPage]);

  // ─── Render ────────────────────────────────────────────────────────────────

  if (loadError) {
    return (
      <div class="gh-lsp-popup" role="alert">
        <div class="gh-lsp-popup__header">
          <span class="gh-lsp-popup__title">gh-lsp</span>
        </div>
        <div class="gh-lsp-popup__body">
          <p class="gh-lsp-popup__error">{loadError}</p>
        </div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div class="gh-lsp-popup">
        <div class="gh-lsp-popup__header">
          <span class="gh-lsp-popup__title">gh-lsp</span>
        </div>
        <div class="gh-lsp-popup__body">
          <p class="gh-lsp-popup__loading">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div class="gh-lsp-popup">
      <div class="gh-lsp-popup__header">
        <span class="gh-lsp-popup__title">gh-lsp</span>
        <label class="gh-lsp-popup__toggle">
          <input
            type="checkbox"
            checked={status.extensionEnabled}
            onChange={handleToggleEnabled}
            aria-label="Toggle extension"
          />
          <span class="gh-lsp-popup__toggle-slider" />
        </label>
      </div>

      <div class="gh-lsp-popup__body">
        {!status.extensionEnabled ? (
          <p class="gh-lsp-popup__disabled-message">Extension is disabled</p>
        ) : !status.isOnSupportedPage ? (
          <p class="gh-lsp-popup__unsupported-message">
            Navigate to a GitHub code page to use gh-lsp
          </p>
        ) : (
          <div class="gh-lsp-popup__status">
            {status.detectedLanguage && (
              <div class="gh-lsp-popup__row">
                <span class="gh-lsp-popup__label">Language</span>
                <span class="gh-lsp-popup__value">
                  {LANGUAGE_LABELS[status.detectedLanguage]}
                </span>
              </div>
            )}

            {status.workerStatus && (
              <div class="gh-lsp-popup__row">
                <span class="gh-lsp-popup__label">Server</span>
                <span class="gh-lsp-popup__value">
                  <span
                    class="gh-lsp-popup__status-dot"
                    style={{ backgroundColor: WORKER_STATUS_COLORS[status.workerStatus] }}
                  />
                  {WORKER_STATUS_LABELS[status.workerStatus]}
                </span>
              </div>
            )}

            <div class="gh-lsp-popup__row">
              <span class="gh-lsp-popup__label">Display</span>
              <button
                type="button"
                class="gh-lsp-popup__mode-btn"
                onClick={handleToggleDisplayMode}
                aria-label={`Switch to ${status.displayMode === 'popover' ? 'sidebar' : 'popover'} mode`}
              >
                {status.displayMode === 'popover' ? 'Popover' : 'Sidebar'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div class="gh-lsp-popup__footer">
        <button
          type="button"
          class="gh-lsp-popup__options-btn"
          onClick={handleOpenOptions}
          aria-label="Open extension settings"
        >
          Settings
        </button>
      </div>
    </div>
  );
};

// ─── Mount ──────────────────────────────────────────────────────────────────

function mount(): void {
  const root = document.getElementById('app');
  if (root) {
    render(<Popup />, root);
  }
}

mount();
