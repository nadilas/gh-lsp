# Phase 1: Shared Foundations — Task Details

## Prerequisites
- Phase 0 (Project Scaffolding) complete ✅
- P1-T1 (Shared Types) complete ✅

## Tasks

### P1-T2: Message Protocol (`src/shared/messages.ts`)

**Purpose**: Provide runtime message creation and validation for the `ExtensionMessage` discriminated union, so content scripts and background worker can safely create and parse messages.

**Implementation guide**:

```typescript
// Factory functions
export function createHoverRequest(
  owner: string, repo: string, ref: string,
  filePath: string, position: LspPosition
): LspHoverRequest;

export function createDefinitionRequest(...): LspDefinitionRequest;
export function createSignatureHelpRequest(...): LspSignatureHelpRequest;
export function createCancelRequest(requestId: string): LspCancelRequest;

// Response factories (used by background)
export function createHoverResponse(requestId: string, result: LspHover | null): LspHoverResponse;
export function createDefinitionResponse(requestId: string, result: LspLocation[]): LspDefinitionResponse;
export function createErrorResponse(requestId: string, error: ExtensionError): LspErrorResponse;

// Validation
export function isExtensionMessage(msg: unknown): msg is ExtensionMessage;
export function isLspRequest(msg: ExtensionMessage): boolean;
export function isLspResponse(msg: ExtensionMessage): boolean;

// Request ID
export function generateRequestId(): string; // e.g., crypto.randomUUID() or counter-based
```

**Tests required**: Message creation returns correct `type` discriminant; validation rejects malformed messages; request IDs are unique.

---

### P1-T3: Constants (`src/shared/constants.ts`)

**Purpose**: Single source of truth for all magic numbers, preventing drift between modules.

**Implementation guide**:

```typescript
// Timing
export const DEFAULT_HOVER_DEBOUNCE_MS = 300;
export const LOADING_INDICATOR_DELAY_MS = 200;
export const POPOVER_FADE_DURATION_MS = 150;

// Cache
export const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Workers
export const DEFAULT_WORKER_IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
export const DEFAULT_MAX_CONCURRENT_WORKERS = 4;

// UI
export const MAX_POPOVER_HEIGHT_PX = 400;
export const SCROLL_DISMISS_THRESHOLD_PX = 50;
export const SIDEBAR_MIN_SIZE_PX = 200;

// GitHub API
export const GITHUB_API_BASE_URL = 'https://api.github.com';
export const GITHUB_RATE_LIMIT_THRESHOLD = 10; // warn when remaining < this
```

**Tests required**: None (pure constants, validated by typecheck).

---

### P1-T4: Settings Schema with Defaults (`src/shared/settings.ts`)

**Purpose**: Centralize settings defaults and provide async helpers for reading/writing settings from `chrome.storage`.

**Implementation guide**:

```typescript
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

export async function getSettings(): Promise<ExtensionSettings>;
export async function saveSettings(partial: Partial<ExtensionSettings>): Promise<void>;
export async function getSecureSettings(): Promise<SecureSettings>;
export async function saveSecureSettings(settings: SecureSettings): Promise<void>;
```

**Key behaviors**:
- `getSettings` merges stored values over `DEFAULT_SETTINGS` (handles schema migration when new fields are added)
- `saveSettings` writes only changed keys to `chrome.storage.sync`
- `getSecureSettings` reads from `chrome.storage.local` (NOT sync, for security)

**Tests required**: Default merge logic (missing fields filled from defaults); partial save only writes provided keys.

---

### P1-T5: Language Registry (`src/shared/languages.ts`)

**Purpose**: Map file extensions to language IDs and WASM binary paths.

**Implementation guide**:

```typescript
import type { SupportedLanguage, FileExtensionMap } from './types';

const FILE_EXTENSION_MAP: FileExtensionMap = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.go': 'go',
  '.rs': 'rust',
  '.py': 'python',
  '.pyi': 'python',
};

export function getLanguageForExtension(ext: string): SupportedLanguage | null;
export function getLanguageForFilePath(filePath: string): SupportedLanguage | null;
export function getWasmPath(language: SupportedLanguage): string;
export function isSupportedLanguage(lang: string): lang is SupportedLanguage;
```

**Tests required**: All extension mappings; unknown extension returns null; `getWasmPath` returns valid paths; `getLanguageForFilePath` extracts extension correctly.

---

## Parallelization Notes

- P1-T2, P1-T3, and P1-T5 can be implemented **in parallel** (they depend only on P1-T1).
- P1-T4 depends on both P1-T1 and P1-T3 (needs constants for defaults).
