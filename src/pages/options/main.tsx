import { render, type FunctionComponent } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import './options.css';
import type {
  ExtensionSettings,
  DisplayMode,
  SidebarPosition,
  SupportedLanguage,
  ThemeMode,
  SecureSettings,
} from '../../shared/types';
import {
  getSettings,
  saveSettings,
  getSecureSettings,
  saveSecureSettings,
} from '../../shared/settings';
import { GITHUB_API_BASE_URL } from '../../shared/constants';

// ─── Constants ───────────────────────────────────────────────────────────────

const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  go: 'Go',
  rust: 'Rust',
  python: 'Python',
};

const ALL_LANGUAGES: SupportedLanguage[] = [
  'typescript',
  'javascript',
  'go',
  'rust',
  'python',
];

const SIDEBAR_POSITION_LABELS: Record<SidebarPosition, string> = {
  right: 'Right',
  left: 'Left',
  top: 'Top',
  bottom: 'Bottom',
};

const THEME_LABELS: Record<ThemeMode, string> = {
  auto: 'Auto (match GitHub)',
  light: 'Light',
  dark: 'Dark',
};

export type PatValidationState = 'idle' | 'validating' | 'valid' | 'invalid';

// ─── Options Component ───────────────────────────────────────────────────────

export interface OptionsProps {
  /** Injected for testing; defaults to global fetch */
  fetchFn?: typeof fetch;
}

export const Options: FunctionComponent<OptionsProps> = ({ fetchFn }) => {
  const [settings, setSettings] = useState<ExtensionSettings | null>(null);
  const [secureSettings, setSecureSettings] = useState<SecureSettings | null>(
    null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  // PAT editing state
  const [patInput, setPatInput] = useState('');
  const [showPat, setShowPat] = useState(false);
  const [patValidation, setPatValidation] =
    useState<PatValidationState>('idle');
  const [patValidationMessage, setPatValidationMessage] = useState('');

  // Load settings on mount
  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        const [currentSettings, currentSecure] = await Promise.all([
          getSettings(),
          getSecureSettings(),
        ]);
        if (cancelled) return;
        setSettings(currentSettings);
        setSecureSettings(currentSecure);
        setPatInput(currentSecure.githubPat);
      } catch (err) {
        if (cancelled) return;
        setLoadError('Failed to load settings');
        console.error('[gh-lsp] Options load error:', err);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // ─── Auto-save helper ──────────────────────────────────────────────────

  const updateSetting = useCallback(
    async <K extends keyof ExtensionSettings>(
      key: K,
      value: ExtensionSettings[K],
    ) => {
      setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
      await saveSettings({ [key]: value });
    },
    [],
  );

  // ─── Display handlers ──────────────────────────────────────────────────

  const handleDisplayModeChange = useCallback(
    (mode: DisplayMode) => {
      void updateSetting('displayMode', mode);
    },
    [updateSetting],
  );

  const handleSidebarPositionChange = useCallback(
    (position: SidebarPosition) => {
      void updateSetting('sidebarPosition', position);
    },
    [updateSetting],
  );

  // ─── Language handlers ─────────────────────────────────────────────────

  const handleLanguageToggle = useCallback(
    (language: SupportedLanguage, enabled: boolean) => {
      if (!settings) return;
      const updated = enabled
        ? [...settings.enabledLanguages, language]
        : settings.enabledLanguages.filter((l) => l !== language);
      void updateSetting('enabledLanguages', updated);
    },
    [settings, updateSetting],
  );

  // ─── Theme handler ────────────────────────────────────────────────────

  const handleThemeChange = useCallback(
    (theme: ThemeMode) => {
      void updateSetting('theme', theme);
    },
    [updateSetting],
  );

  // ─── Performance handlers ──────────────────────────────────────────────

  const handleDebounceChange = useCallback(
    (value: number) => {
      void updateSetting('hoverDebounceMs', value);
    },
    [updateSetting],
  );

  const handleCacheTtlChange = useCallback(
    (value: number) => {
      void updateSetting('cacheTimeoutMinutes', value);
    },
    [updateSetting],
  );

  const handleWorkerIdleChange = useCallback(
    (value: number) => {
      void updateSetting('workerIdleTimeoutMinutes', value);
    },
    [updateSetting],
  );

  const handleMaxWorkersChange = useCallback(
    (value: number) => {
      void updateSetting('maxConcurrentWorkers', value);
    },
    [updateSetting],
  );

  // ─── PAT handlers ─────────────────────────────────────────────────────

  const handlePatSave = useCallback(async () => {
    const newSecure: SecureSettings = { githubPat: patInput };
    await saveSecureSettings(newSecure);
    setSecureSettings(newSecure);
    setPatValidation('idle');
    setPatValidationMessage('');
  }, [patInput]);

  const handlePatValidate = useCallback(async () => {
    if (!patInput) {
      setPatValidation('invalid');
      setPatValidationMessage('No token provided');
      return;
    }

    setPatValidation('validating');
    setPatValidationMessage('');

    try {
      const doFetch = fetchFn ?? fetch;
      const response = await doFetch(`${GITHUB_API_BASE_URL}/user`, {
        headers: {
          Authorization: `token ${patInput}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });

      if (response.ok) {
        const data = (await response.json()) as { login?: string };
        setPatValidation('valid');
        setPatValidationMessage(
          `Authenticated as ${data.login ?? 'unknown'}`,
        );
      } else {
        setPatValidation('invalid');
        setPatValidationMessage(
          `Authentication failed (${response.status})`,
        );
      }
    } catch {
      setPatValidation('invalid');
      setPatValidationMessage('Network error during validation');
    }
  }, [patInput, fetchFn]);

  const handlePatToggleVisibility = useCallback(() => {
    setShowPat((prev) => !prev);
  }, []);

  // ─── Masked PAT display ────────────────────────────────────────────────

  function maskPat(pat: string): string {
    if (!pat) return '';
    if (pat.length <= 8) return '****';
    return `${pat.slice(0, 4)}${'*'.repeat(Math.min(pat.length - 8, 20))}${pat.slice(-4)}`;
  }

  // ─── Render ────────────────────────────────────────────────────────────

  if (loadError) {
    return (
      <div class="gh-lsp-options" role="alert">
        <h1 class="gh-lsp-options__title">gh-lsp Settings</h1>
        <p class="gh-lsp-options__error">{loadError}</p>
      </div>
    );
  }

  if (!settings || !secureSettings) {
    return (
      <div class="gh-lsp-options">
        <h1 class="gh-lsp-options__title">gh-lsp Settings</h1>
        <p class="gh-lsp-options__loading">Loading settings...</p>
      </div>
    );
  }

  return (
    <div class="gh-lsp-options">
      <h1 class="gh-lsp-options__title">gh-lsp Settings</h1>

      {/* Display Section */}
      <section class="gh-lsp-options__section" aria-label="Display settings">
        <h2 class="gh-lsp-options__section-title">Display</h2>

        <div class="gh-lsp-options__field">
          <span class="gh-lsp-options__label">Display Mode</span>
          <div class="gh-lsp-options__radio-group">
            <label class="gh-lsp-options__radio-label">
              <input
                type="radio"
                name="displayMode"
                value="popover"
                checked={settings.displayMode === 'popover'}
                onChange={() => handleDisplayModeChange('popover')}
              />
              Popover
            </label>
            <label class="gh-lsp-options__radio-label">
              <input
                type="radio"
                name="displayMode"
                value="sidebar"
                checked={settings.displayMode === 'sidebar'}
                onChange={() => handleDisplayModeChange('sidebar')}
              />
              Sidebar
            </label>
          </div>
        </div>

        <div class="gh-lsp-options__field">
          <label class="gh-lsp-options__label">
            Sidebar Position
            <select
              class="gh-lsp-options__select"
              value={settings.sidebarPosition}
              onChange={(e) =>
                handleSidebarPositionChange(
                  (e.target as HTMLSelectElement).value as SidebarPosition,
                )
              }
            >
              {(
                Object.entries(SIDEBAR_POSITION_LABELS) as [
                  SidebarPosition,
                  string,
                ][]
              ).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {/* Languages Section */}
      <section class="gh-lsp-options__section" aria-label="Language settings">
        <h2 class="gh-lsp-options__section-title">Languages</h2>
        <div class="gh-lsp-options__checkbox-group">
          {ALL_LANGUAGES.map((lang) => (
            <label key={lang} class="gh-lsp-options__checkbox-label">
              <input
                type="checkbox"
                checked={settings.enabledLanguages.includes(lang)}
                onChange={(e) =>
                  handleLanguageToggle(
                    lang,
                    (e.target as HTMLInputElement).checked,
                  )
                }
              />
              {LANGUAGE_LABELS[lang]}
            </label>
          ))}
        </div>
      </section>

      {/* Authentication Section */}
      <section
        class="gh-lsp-options__section"
        aria-label="Authentication settings"
      >
        <h2 class="gh-lsp-options__section-title">Authentication</h2>
        <div class="gh-lsp-options__field">
          <span class="gh-lsp-options__label">GitHub Personal Access Token</span>
          <div class="gh-lsp-options__input-row">
            <input
              class="gh-lsp-options__input"
              type={showPat ? 'text' : 'password'}
              value={patInput}
              onInput={(e) =>
                setPatInput((e.target as HTMLInputElement).value)
              }
              placeholder="ghp_..."
              aria-label="GitHub Personal Access Token"
            />
            <button
              type="button"
              class="gh-lsp-options__btn"
              onClick={handlePatToggleVisibility}
              aria-label={showPat ? 'Hide token' : 'Show token'}
            >
              {showPat ? 'Hide' : 'Show'}
            </button>
          </div>
          <div class="gh-lsp-options__input-row" style={{ marginTop: '8px' }}>
            <button
              type="button"
              class="gh-lsp-options__btn"
              onClick={handlePatSave}
            >
              Save
            </button>
            <button
              type="button"
              class="gh-lsp-options__btn"
              onClick={handlePatValidate}
              disabled={patValidation === 'validating'}
            >
              {patValidation === 'validating' ? 'Validating...' : 'Validate'}
            </button>
          </div>
          {secureSettings.githubPat && (
            <p class="gh-lsp-options__pat-masked">
              Saved: {maskPat(secureSettings.githubPat)}
            </p>
          )}
          {patValidationMessage && (
            <p
              class={`gh-lsp-options__status ${
                patValidation === 'valid'
                  ? 'gh-lsp-options__status--success'
                  : 'gh-lsp-options__status--error'
              }`}
            >
              {patValidationMessage}
            </p>
          )}
        </div>
      </section>

      {/* Performance Section */}
      <section
        class="gh-lsp-options__section"
        aria-label="Performance settings"
      >
        <h2 class="gh-lsp-options__section-title">Performance</h2>

        <div class="gh-lsp-options__field">
          <span class="gh-lsp-options__label">
            Hover Debounce ({settings.hoverDebounceMs}ms)
          </span>
          <div class="gh-lsp-options__range-row">
            <input
              class="gh-lsp-options__range"
              type="range"
              min="100"
              max="1000"
              step="50"
              value={settings.hoverDebounceMs}
              onInput={(e) =>
                handleDebounceChange(
                  parseInt((e.target as HTMLInputElement).value, 10),
                )
              }
              aria-label="Hover debounce"
            />
            <span class="gh-lsp-options__range-value">
              {settings.hoverDebounceMs}ms
            </span>
          </div>
        </div>

        <div class="gh-lsp-options__field">
          <span class="gh-lsp-options__label">
            Cache TTL ({settings.cacheTimeoutMinutes} min)
          </span>
          <div class="gh-lsp-options__range-row">
            <input
              class="gh-lsp-options__range"
              type="range"
              min="1"
              max="60"
              step="1"
              value={settings.cacheTimeoutMinutes}
              onInput={(e) =>
                handleCacheTtlChange(
                  parseInt((e.target as HTMLInputElement).value, 10),
                )
              }
              aria-label="Cache TTL"
            />
            <span class="gh-lsp-options__range-value">
              {settings.cacheTimeoutMinutes} min
            </span>
          </div>
        </div>

        <div class="gh-lsp-options__field">
          <span class="gh-lsp-options__label">
            Worker Idle Timeout ({settings.workerIdleTimeoutMinutes} min)
          </span>
          <div class="gh-lsp-options__range-row">
            <input
              class="gh-lsp-options__range"
              type="range"
              min="1"
              max="30"
              step="1"
              value={settings.workerIdleTimeoutMinutes}
              onInput={(e) =>
                handleWorkerIdleChange(
                  parseInt((e.target as HTMLInputElement).value, 10),
                )
              }
              aria-label="Worker idle timeout"
            />
            <span class="gh-lsp-options__range-value">
              {settings.workerIdleTimeoutMinutes} min
            </span>
          </div>
        </div>

        <div class="gh-lsp-options__field">
          <span class="gh-lsp-options__label">
            Max Workers ({settings.maxConcurrentWorkers})
          </span>
          <div class="gh-lsp-options__range-row">
            <input
              class="gh-lsp-options__range"
              type="range"
              min="1"
              max="8"
              step="1"
              value={settings.maxConcurrentWorkers}
              onInput={(e) =>
                handleMaxWorkersChange(
                  parseInt((e.target as HTMLInputElement).value, 10),
                )
              }
              aria-label="Max concurrent workers"
            />
            <span class="gh-lsp-options__range-value">
              {settings.maxConcurrentWorkers}
            </span>
          </div>
        </div>
      </section>

      {/* Theme Section */}
      <section class="gh-lsp-options__section" aria-label="Theme settings">
        <h2 class="gh-lsp-options__section-title">Theme</h2>
        <div class="gh-lsp-options__radio-group">
          {(
            Object.entries(THEME_LABELS) as [ThemeMode, string][]
          ).map(([value, label]) => (
            <label key={value} class="gh-lsp-options__radio-label">
              <input
                type="radio"
                name="theme"
                value={value}
                checked={settings.theme === value}
                onChange={() => handleThemeChange(value)}
              />
              {label}
            </label>
          ))}
        </div>
      </section>

      {/* About Section */}
      <section class="gh-lsp-options__section" aria-label="About">
        <h2 class="gh-lsp-options__section-title">About</h2>
        <div class="gh-lsp-options__about-row">
          <span>Version</span>
          <span>0.1.0</span>
        </div>
        <div class="gh-lsp-options__about-row">
          <span>Source</span>
          <a
            class="gh-lsp-options__about-link"
            href="https://github.com/nadilas/gh-lsp"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
        </div>
      </section>
    </div>
  );
};

// ─── Mount ──────────────────────────────────────────────────────────────────

function mount(): void {
  const root = document.getElementById('app');
  if (root) {
    render(<Options />, root);
  }
}

mount();
