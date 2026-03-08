import type { ExtensionSettings, SecureSettings } from './types';

export const DEFAULT_SETTINGS: ExtensionSettings = {
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
};

const SETTINGS_STORAGE_KEY = 'gh-lsp-settings';
const SECURE_STORAGE_KEY = 'gh-lsp-secure';

/**
 * Reads extension settings from chrome.storage.sync, merging stored values
 * over DEFAULT_SETTINGS so that new fields added in future versions get
 * sensible defaults automatically.
 */
export async function getSettings(): Promise<ExtensionSettings> {
  const result = await chrome.storage.sync.get(SETTINGS_STORAGE_KEY);
  const stored = result[SETTINGS_STORAGE_KEY] as
    | Partial<ExtensionSettings>
    | undefined;

  if (!stored) {
    return { ...DEFAULT_SETTINGS };
  }

  return { ...DEFAULT_SETTINGS, ...stored };
}

/**
 * Writes only the provided keys to chrome.storage.sync, preserving
 * any other stored settings. This avoids overwriting fields the caller
 * doesn't intend to change.
 */
export async function saveSettings(
  partial: Partial<ExtensionSettings>,
): Promise<void> {
  const current = await getSettings();
  const merged = { ...current, ...partial };
  await chrome.storage.sync.set({ [SETTINGS_STORAGE_KEY]: merged });
}

/**
 * Reads the GitHub PAT from chrome.storage.local (NOT sync, for security).
 * Returns an empty PAT string when nothing is stored.
 */
export async function getSecureSettings(): Promise<SecureSettings> {
  const result = await chrome.storage.local.get(SECURE_STORAGE_KEY);
  const stored = result[SECURE_STORAGE_KEY] as SecureSettings | undefined;
  return stored ?? { githubPat: '' };
}

/**
 * Writes the secure settings (GitHub PAT) to chrome.storage.local.
 */
export async function saveSecureSettings(
  settings: SecureSettings,
): Promise<void> {
  await chrome.storage.local.set({ [SECURE_STORAGE_KEY]: settings });
}
