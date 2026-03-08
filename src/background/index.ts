/**
 * Background service worker entry point.
 * Manages LSP request routing, worker pool, caching, and GitHub API integration.
 */

import { LruCache } from './cache';
import { GitHubApiClient } from './github-api';
import { DocumentSync } from './document-sync';
import { WorkerPool } from './worker-pool';
import { LspRouter } from './lsp-router';
import { getSettings, saveSettings } from '../shared/settings';
import { isExtensionMessage, isLspRequest } from '../shared/messages';
import { DEFAULT_CACHE_TTL_MS } from '../shared/constants';
import browser, { type Runtime, type Storage } from '../shared/browser';
import type {
  ExtensionMessage,
  ExtensionSettings,
  SupportedLanguage,
  WorkerStatus,
  GitHubRateLimitInfo,
} from '../shared/types';

// ─── Cache sizing constants ──────────────────────────────────────────────────

const RESPONSE_CACHE_MAX_ENTRIES = 500;
const FILE_CONTENT_CACHE_MAX_ENTRIES = 200;

// ─── Subsystems ──────────────────────────────────────────────────────────────

const responseCache = new LruCache<unknown>(
  RESPONSE_CACHE_MAX_ENTRIES,
  DEFAULT_CACHE_TTL_MS,
);

const fileContentCache = new LruCache<string>(
  FILE_CONTENT_CACHE_MAX_ENTRIES,
  DEFAULT_CACHE_TTL_MS,
);

const apiClient = new GitHubApiClient();
const documentSync = new DocumentSync(apiClient, fileContentCache);

let workerPool: WorkerPool | null = null;
let lspRouter: LspRouter | null = null;
let initialized = false;

/**
 * Initializes the worker pool and LSP router from current settings.
 * Called once on service worker start and re-called on pool-affecting
 * settings changes.
 */
async function initialize(): Promise<void> {
  if (initialized && workerPool) {
    await workerPool.terminateAll();
  }

  const settings = await getSettings();

  workerPool = new WorkerPool(
    settings.maxConcurrentWorkers,
    settings.workerIdleTimeoutMinutes * 60 * 1000,
  );

  workerPool.setStatusCallback(
    (language: SupportedLanguage, status: WorkerStatus) => {
      broadcastToGitHubTabs({
        type: 'worker/status',
        language,
        status,
      });
    },
  );

  apiClient.setRateLimitWarningCallback((info: GitHubRateLimitInfo) => {
    broadcastToGitHubTabs({
      type: 'rateLimit/warning',
      resetAt: info.resetAt,
    });
  });

  lspRouter = new LspRouter(
    workerPool,
    documentSync,
    responseCache,
    getSettings,
  );

  initialized = true;
  console.debug('[gh-lsp] Background service worker initialized');
}

/**
 * Ensures the subsystems are initialized before handling an LSP request.
 * MV3 service workers can be killed and restarted, so initialization
 * must be lazy-recoverable.
 */
async function ensureInitialized(): Promise<void> {
  if (!initialized || !lspRouter || !workerPool) {
    await initialize();
  }
}

// ─── Message dispatch ────────────────────────────────────────────────────────

browser.runtime.onMessage.addListener(
  (
    message: unknown,
    _sender: Runtime.MessageSender,
  ): Promise<ExtensionMessage | undefined> | undefined => {
    if (!isExtensionMessage(message)) {
      return undefined;
    }

    return dispatchMessageAsync(message);
  },
);

async function dispatchMessageAsync(
  message: ExtensionMessage,
): Promise<ExtensionMessage | undefined> {
  try {
    if (isLspRequest(message)) {
      await ensureInitialized();
      return await lspRouter!.handleRequest(message);
    }

    switch (message.type) {
      case 'extension/toggle':
        await handleExtensionToggle(message.enabled);
        break;

      case 'page/navigated':
        // Content script reports a Turbo/PJAX navigation.
        // Future use: preemptive worker spawning for detected language.
        break;
    }
  } catch (error) {
    console.error('[gh-lsp] Message dispatch error:', error);
  }

  return undefined;
}

// ─── Extension toggle ────────────────────────────────────────────────────────

async function handleExtensionToggle(enabled: boolean): Promise<void> {
  await saveSettings({ enabled });

  broadcastToGitHubTabs({
    type: 'extension/toggle',
    enabled,
  });

  if (!enabled && workerPool) {
    await workerPool.terminateAll();
    responseCache.clear();
  }
}

// ─── Keyboard commands ───────────────────────────────────────────────────────

browser.commands.onCommand.addListener((command: string) => {
  void handleCommand(command);
});

async function handleCommand(command: string): Promise<void> {
  switch (command) {
    case 'toggle-extension': {
      const settings = await getSettings();
      await handleExtensionToggle(!settings.enabled);
      break;
    }

    case 'toggle-sidebar':
      await forwardCommandToActiveTab('toggle-sidebar');
      break;

    case 'pin-popover':
      await forwardCommandToActiveTab('pin-popover');
      break;
  }
}

// ─── Settings change propagation ─────────────────────────────────────────────

browser.storage.onChanged.addListener(
  (
    changes: Record<string, Storage.StorageChange>,
    areaName: string,
  ) => {
    if (areaName !== 'sync') {
      return;
    }

    const settingsChange = changes['gh-lsp-settings'];
    if (!settingsChange?.newValue) {
      return;
    }

    const oldSettings = (settingsChange.oldValue ?? {}) as Partial<ExtensionSettings>;
    const newSettings = settingsChange.newValue as ExtensionSettings;

    const diff = computeSettingsDiff(oldSettings, newSettings);
    if (Object.keys(diff).length === 0) {
      return;
    }

    broadcastToGitHubTabs({
      type: 'settings/changed',
      changes: diff,
    });

    // If extension was disabled via settings, tear down workers
    if (diff.enabled === false && workerPool) {
      void workerPool.terminateAll();
      responseCache.clear();
    }
  },
);

function computeSettingsDiff(
  oldSettings: Partial<ExtensionSettings>,
  newSettings: ExtensionSettings,
): Partial<ExtensionSettings> {
  const diff: Partial<ExtensionSettings> = {};

  for (const key of Object.keys(newSettings) as (keyof ExtensionSettings)[]) {
    if (JSON.stringify(oldSettings[key]) !== JSON.stringify(newSettings[key])) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (diff as any)[key] = newSettings[key];
    }
  }

  return diff;
}

// ─── Tab messaging helpers ───────────────────────────────────────────────────

async function forwardCommandToActiveTab(command: string): Promise<void> {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (tab?.id != null) {
    browser.tabs.sendMessage(tab.id, { command }).catch(() => {
      // Tab may not have content script loaded
    });
  }
}

function broadcastToGitHubTabs(message: ExtensionMessage): void {
  void browser.tabs.query({ url: 'https://github.com/*' }).then((tabs) => {
    for (const tab of tabs) {
      if (tab.id != null) {
        browser.tabs.sendMessage(tab.id, message).catch(() => {
          // Tab may not have content script loaded yet
        });
      }
    }
  });
}

// ─── Service worker start ────────────────────────────────────────────────────

void initialize();
