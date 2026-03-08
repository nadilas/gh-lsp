# gh-lsp — Implementation Dependency Graph

## How to Use This Document

This document defines every implementation task for the gh-lsp browser extension, organized as a directed acyclic graph (DAG). Each task has:

- **ID**: Unique identifier (e.g., `P1-T1`)
- **Dependencies**: Tasks that MUST be completed before this task can start
- **Outputs**: Files/artifacts this task produces
- **Acceptance criteria**: How to verify the task is done

Tasks within the same phase can often be parallelized. Cross-phase dependencies are always sequential.

---

## Dependency Graph (Visual)

```
P0-T1 (Scaffolding) ✅ DONE
  │
  ├──→ P1-T1 (Shared Types) ✅ DONE
  │      │
  │      ├──→ P1-T2 (Message Protocol)
  │      │      │
  │      ├──→ P1-T3 (Constants)
  │      │      │
  │      ├──→ P1-T4 (Settings Helpers)
  │      │      │
  │      └──→ P1-T5 (Language Registry)
  │             │
  │      ┌──────┴──────────────────────────┐
  │      │                                 │
  │      ▼                                 ▼
  │   P2-T1 (Background Entry)         P5-T1 (Page Detector)
  │      │                                 │
  │      ├──→ P2-T2 (GitHub API Client)    ├──→ P5-T2 (DOM Observer)
  │      │      │                          │      │
  │      ├──→ P2-T3 (Response Cache)       ├──→ P5-T3 (Token Detector)
  │      │      │                          │      │
  │      └──→ P2-T4 (Document Sync)       ├──→ P5-T4 (Messaging Layer)
  │             │                          │      │
  │      ┌──────┘                          └──→ P5-T5 (Content Entry)
  │      │                                        │
  │      ▼                                        │
  │   P3-T1 (JSON-RPC Transport)                  │
  │      │                                        │
  │      ├──→ P3-T2 (Virtual File System)         │
  │      │                                        │
  │      ├──→ P3-T3 (Language Registry Worker)    │
  │      │      │                                 │
  │      ├──→ P3-T4 (Worker Pool Manager)         │
  │      │      │                                 │
  │      └──→ P3-T5 (LSP Router)                 │
  │             │                                 │
  │             ▼                                 │
  │   P4-T1 (WASM TS Server)                     │
  │      │                                        │
  │      ├──→ P4-T2 (WASM Loader)                │
  │      │      │                                 │
  │      └──→ P4-T3 (Additional WASM Servers)    │
  │             │                                 │
  │      ┌──────┘                                 │
  │      │      ┌─────────────────────────────────┘
  │      ▼      ▼
  │   P6-T1 (Shadow DOM Mount)
  │      │
  │      ├──→ P6-T2 (Popover Positioning)
  │      │      │
  │      ├──→ P6-T3 (Popover Component)
  │      │      │
  │      ├──→ P6-T4 (Display Subcomponents)
  │      │      │
  │      └──→ P6-T5 (Theme Detection)
  │             │
  │             ▼
  │   P7-T1 (Sidebar Component)
  │      │
  │      ├──→ P7-T2 (Resize Handler)
  │      │
  │      └──→ P7-T3 (Sidebar Integration)
  │             │
  │             ▼
  │   P8-T1 (Popup Page)
  │      │
  │      ├──→ P8-T2 (Options Page)
  │      │
  │      ├──→ P8-T3 (Settings Wiring)
  │      │
  │      └──→ P8-T4 (Keyboard Shortcuts)
  │             │
  │             ▼
  │   P9-T1 (Polyfill Integration)
  │      │
  │      ├──→ P9-T2 (Safari Build)
  │      │
  │      └──→ P9-T3 (Safari Verification)
  │             │
  │             ▼
  │   P10-T1 (Accessibility)
  │      │
  │      └──→ P10-T2 (i18n Support)
  │             │
  │             ▼
  │   P11-T1 (E2E Test Setup)
  │      │
  │      └──→ P11-T2 (E2E Test Suite)
  │             │
  │             ▼
  │   P12-T1 (CI Pipeline)
  │      │
  │      └──→ P12-T2 (Release Pipeline)
```

---

## Phase 0: Project Scaffolding — ✅ COMPLETE

### P0-T1: Initialize Project

- **Status**: ✅ DONE
- **Dependencies**: None
- **Outputs**: `package.json`, `tsconfig.json`, `vite.config.ts`, `eslint.config.js`, `.prettierrc`, `.gitignore`, `src/manifest.json`
- **Acceptance**: `pnpm install` succeeds, `pnpm typecheck` passes, `pnpm build` produces output in `dist/chrome/`

---

## Phase 1: Shared Foundations

### P1-T1: Shared TypeScript Types — ✅ COMPLETE

- **Status**: ✅ DONE
- **Dependencies**: `P0-T1`
- **Outputs**: `src/shared/types.ts`
- **Acceptance**: All LSP types, JSON-RPC types, extension message types, settings types, UI state types, error types are defined. `pnpm typecheck` passes.

### P1-T2: Message Protocol

- **Status**: ⬜ TODO
- **Dependencies**: `P1-T1`
- **Outputs**: `src/shared/messages.ts`
- **Spec reference**: `openspec/specs/background-service-worker/spec.md` (Communication), `openspec/specs/content-script/spec.md` (Communication with Background)
- **Description**: Create typed message factory functions and validation helpers for content-to-background communication. Must ensure messages conform to the `ExtensionMessage` discriminated union.
- **Acceptance criteria**:
  - Factory functions for each message type (e.g., `createHoverRequest(...)`)
  - Type-safe message parsing/validation with runtime checks
  - Request ID generation (unique per request)
  - Unit tests for message creation and validation
  - `pnpm typecheck` passes

### P1-T3: Constants

- **Status**: ⬜ TODO
- **Dependencies**: `P1-T1`
- **Outputs**: `src/shared/constants.ts`
- **Description**: Define all magic numbers and configuration defaults as named constants.
- **Acceptance criteria**:
  - `DEFAULT_HOVER_DEBOUNCE_MS`: 300
  - `DEFAULT_CACHE_TTL_MS`: 600000 (10 min)
  - `DEFAULT_WORKER_IDLE_TIMEOUT_MS`: 300000 (5 min)
  - `DEFAULT_MAX_CONCURRENT_WORKERS`: 4
  - `MAX_POPOVER_HEIGHT_PX`: 400
  - `POPOVER_FADE_DURATION_MS`: 150
  - `SCROLL_DISMISS_THRESHOLD_PX`: 50
  - `LOADING_INDICATOR_DELAY_MS`: 200
  - `GITHUB_API_BASE_URL`: `"https://api.github.com"`
  - `pnpm typecheck` passes

### P1-T4: Settings Schema with Defaults

- **Status**: ⬜ TODO
- **Dependencies**: `P1-T1`, `P1-T3`
- **Outputs**: `src/shared/settings.ts`
- **Spec reference**: `openspec/specs/extension-settings/spec.md`
- **Description**: Create the default settings object, and read/write helpers that wrap `chrome.storage.sync` and `chrome.storage.local` (for PAT).
- **Acceptance criteria**:
  - `DEFAULT_SETTINGS` object matching spec defaults
  - `getSettings(): Promise<ExtensionSettings>` — reads from storage, merges with defaults
  - `saveSettings(partial: Partial<ExtensionSettings>): Promise<void>` — persists to sync storage
  - `getSecureSettings(): Promise<SecureSettings>` — reads PAT from local storage
  - `saveSecureSettings(settings: SecureSettings): Promise<void>`
  - Unit tests for merge-with-defaults logic (mock `chrome.storage`)
  - `pnpm typecheck` passes

### P1-T5: Language Registry

- **Status**: ⬜ TODO
- **Dependencies**: `P1-T1`
- **Outputs**: `src/shared/languages.ts`
- **Spec reference**: `openspec/specs/lsp-worker/spec.md` (Supported Language Servers)
- **Description**: Map file extensions to `SupportedLanguage` IDs and WASM binary paths.
- **Acceptance criteria**:
  - `getLanguageForExtension(ext: string): SupportedLanguage | null`
  - Mapping: `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs` → `typescript`; `.go` → `go`; `.rs` → `rust`; `.py`, `.pyi` → `python`
  - `getWasmPath(language: SupportedLanguage): string` — returns path like `lsp/wasm/{language}-server.wasm`
  - Unit tests for all extension mappings including edge cases (unknown extensions)
  - `pnpm typecheck` passes

---

## Phase 2: Background Service Worker — Core

### P2-T1: Background Entry Point

- **Status**: ⬜ TODO
- **Dependencies**: `P1-T2`, `P1-T4`
- **Outputs**: `src/background/index.ts`
- **Spec reference**: `openspec/specs/background-service-worker/spec.md`
- **Description**: Set up the background service worker's message listener (`chrome.runtime.onMessage`), initialize settings, wire up all background modules.
- **Acceptance criteria**:
  - Listens for `ExtensionMessage` types from content scripts
  - Dispatches to appropriate handler based on `message.type`
  - Sends responses back via `sendResponse` or `chrome.tabs.sendMessage`
  - Handles `extension/toggle` and `settings/changed` messages
  - `pnpm typecheck` passes

### P2-T2: GitHub API Client

- **Status**: ⬜ TODO
- **Dependencies**: `P1-T1`, `P1-T3`, `P1-T4`
- **Outputs**: `src/background/github-api.ts`
- **Spec reference**: `openspec/specs/background-service-worker/spec.md` (GitHub API Integration)
- **Description**: HTTP client for GitHub REST API. Handles authentication (PAT), rate limiting with exponential backoff and jitter, file content fetching and base64 decoding.
- **Acceptance criteria**:
  - `fetchFileContent(owner, repo, ref, path): Promise<string>` — fetches raw file content
  - Authenticated requests when PAT is configured (Authorization header)
  - Unauthenticated requests when no PAT
  - Rate limit detection from HTTP 403/429 + `X-RateLimit-*` headers
  - Exponential backoff with jitter on rate limit
  - Proper error mapping: 404 → `fetch_not_found`, 401 → `fetch_unauthorized`, network error → `fetch_error`
  - Rate limit warning notification to content script
  - Unit tests for: auth header inclusion, rate limit detection, backoff logic, error mapping, base64 decoding
  - `pnpm typecheck` passes

### P2-T3: Response Cache

- **Status**: ⬜ TODO
- **Dependencies**: `P1-T1`, `P1-T3`
- **Outputs**: `src/background/cache.ts`
- **Spec reference**: `openspec/specs/background-service-worker/spec.md` (Response Caching)
- **Description**: LRU cache with TTL. Keyed by `{owner}/{repo}/{ref}/{filePath}:{line}:{character}`. Supports invalidation by ref change.
- **Acceptance criteria**:
  - `get(key: string): T | null` — returns cached value if not expired
  - `set(key: string, value: T, ttlMs?: number): void` — stores with TTL
  - `invalidateByPrefix(prefix: string): void` — invalidates all entries matching prefix (for ref changes)
  - LRU eviction when max entries exceeded
  - Unit tests for: TTL expiration, LRU eviction, prefix invalidation, cache hit/miss
  - `pnpm typecheck` passes

### P2-T4: Document Sync

- **Status**: ⬜ TODO
- **Dependencies**: `P2-T2`, `P2-T3`
- **Outputs**: `src/background/document-sync.ts`
- **Spec reference**: `openspec/specs/background-service-worker/spec.md` (Document Synchronization)
- **Description**: Manages fetching file content from GitHub API (or cache), tracking which files have been opened on which workers, and sending `textDocument/didOpen` notifications.
- **Acceptance criteria**:
  - `ensureDocumentOpen(worker, owner, repo, ref, filePath): Promise<void>` — fetches if needed, sends didOpen
  - Caches file content to avoid re-fetching
  - Tracks which documents are open on which workers
  - Handles cross-file resolution requests from workers
  - Unit tests with mocked GitHub API client
  - `pnpm typecheck` passes

---

## Phase 3: LSP Worker Infrastructure

### P3-T1: JSON-RPC 2.0 Transport

- **Status**: ⬜ TODO
- **Dependencies**: `P1-T1`
- **Outputs**: `src/workers/lsp-worker.ts`
- **Spec reference**: `openspec/specs/lsp-worker/spec.md` (JSON-RPC 2.0 Transport)
- **Description**: Implement JSON-RPC 2.0 message encoding/decoding over `postMessage`. Handle request/response correlation by ID, notification dispatch, and error response creation.
- **Acceptance criteria**:
  - `createRequest(method, params): JsonRpcRequest` — auto-incrementing ID
  - `createNotification(method, params): JsonRpcNotification`
  - `createErrorResponse(id, code, message): JsonRpcErrorResponse`
  - `createSuccessResponse(id, result): JsonRpcSuccessResponse`
  - `isRequest(msg)`, `isNotification(msg)`, `isResponse(msg)` — type guards
  - Pending request tracking with timeout support
  - Unit tests for: message creation, type guards, request correlation, timeout handling
  - `pnpm typecheck` passes

### P3-T2: Virtual File System

- **Status**: ⬜ TODO
- **Dependencies**: `P1-T1`
- **Outputs**: `src/workers/vfs.ts`
- **Spec reference**: `openspec/specs/lsp-worker/spec.md` (Virtual File System)
- **Description**: In-memory file storage for WASM language servers. URI-based lookup, file registration via `textDocument/didOpen`, file-not-found notification.
- **Acceptance criteria**:
  - `registerFile(uri: string, content: string, version: number): void`
  - `getFile(uri: string): { content: string; version: number } | null`
  - `removeFile(uri: string): void`
  - `listFiles(): string[]`
  - Emits `gh-lsp/requestFile` notification when a file is requested but not found
  - Unit tests for: register, get, remove, list, not-found notification
  - `pnpm typecheck` passes

### P3-T3: Language Registry (Worker-side)

- **Status**: ⬜ TODO
- **Dependencies**: `P1-T5`
- **Outputs**: `src/workers/language-registry.ts`
- **Description**: Worker-side language detection: WASM binary loader, capability declaration per language server.
- **Acceptance criteria**:
  - `loadWasmServer(language: SupportedLanguage): Promise<WasmServer>` — fetches and instantiates WASM
  - `getCapabilities(language): LspServerCapabilities` — declares what each server supports
  - Unit tests with mocked WASM loading
  - `pnpm typecheck` passes

### P3-T4: Worker Pool Manager

- **Status**: ⬜ TODO
- **Dependencies**: `P3-T1`, `P1-T3`, `P1-T4`
- **Outputs**: `src/background/worker-pool.ts`
- **Spec reference**: `openspec/specs/background-service-worker/spec.md` (Web Worker Pool Management)
- **Description**: Manages lifecycle of Web Workers running LSP servers. Spawn, reuse, evict (LRU), idle timeout, crash recovery, max concurrency enforcement.
- **Acceptance criteria**:
  - `getOrCreateWorker(language): Promise<ManagedWorker>` — reuses existing or spawns new
  - Idle timeout: terminates workers after configurable inactivity period
  - Max concurrency: evicts LRU worker when limit reached
  - Crash recovery: detects `onerror`, rejects pending requests, respawns on next request
  - Worker status tracking and notification to content scripts
  - Unit tests for: reuse, idle eviction, LRU eviction, crash recovery, max concurrency
  - `pnpm typecheck` passes

### P3-T5: LSP Router

- **Status**: ⬜ TODO
- **Dependencies**: `P3-T4`, `P2-T4`, `P1-T5`
- **Outputs**: `src/background/lsp-router.ts`
- **Spec reference**: `openspec/specs/background-service-worker/spec.md` (LSP Request Routing)
- **Description**: Routes incoming LSP requests from content scripts to the correct language server worker. Detects language from file extension, ensures document is synced, forwards request, returns response.
- **Acceptance criteria**:
  - `routeRequest(message: ExtensionMessage): Promise<ExtensionMessage>` — full request lifecycle
  - Language detection from file extension
  - Unsupported language error response
  - Document sync before first request to a file
  - Cache check before forwarding to worker
  - Cancel request forwarding
  - Unit tests for: routing to correct language, unsupported language, cache hit, cancel
  - `pnpm typecheck` passes

---

## Phase 4: WASM Language Server Integration

### P4-T1: TypeScript WASM Server Research & Sourcing

- **Status**: ⬜ TODO
- **Dependencies**: `P3-T1`, `P3-T2`
- **Description**: Research existing TypeScript language server WASM builds. Options: compile `typescript` + `tsserver` to WASM, use existing projects like `vscode-wasm-typescript`, or create a minimal hover/definition-only TS analyzer.
- **Acceptance criteria**:
  - Decision document in `openspec/decisions/wasm-ts-server.md`
  - Working WASM binary or build script
  - Binary loads in a Web Worker successfully

### P4-T2: WASM Loader for TypeScript

- **Status**: ⬜ TODO
- **Dependencies**: `P4-T1`, `P3-T3`
- **Outputs**: `src/lsp/typescript-loader.ts`
- **Description**: Initialize the TypeScript WASM server, configure capabilities, verify hover and definition responses work.
- **Acceptance criteria**:
  - Loads WASM binary in Web Worker
  - Completes LSP `initialize` / `initialized` handshake
  - Returns valid hover response for a simple TypeScript file
  - Returns valid definition response
  - Integration test with a real WASM server

### P4-T3: Additional WASM Servers (Go, Rust, Python)

- **Status**: ⬜ TODO
- **Dependencies**: `P4-T2`
- **Description**: Research and integrate WASM builds for Go (gopls), Rust (rust-analyzer), Python (pyright/pylsp). Each follows the same loader pattern as TypeScript.
- **Acceptance criteria**:
  - At least one additional language server working
  - Each produces correct hover responses for simple files
  - Integration tests for each server

---

## Phase 5: Content Script

### P5-T1: Page Detector

- **Status**: ⬜ TODO
- **Dependencies**: `P1-T1`
- **Outputs**: `src/content/page-detector.ts`
- **Spec reference**: `openspec/specs/content-script/spec.md` (GitHub Page Detection)
- **Description**: URL pattern matching for GitHub code views (blob, PR files, compare). Turbo navigation detection via `turbo:load` events.
- **Acceptance criteria**:
  - `detectPageType(url: string): GitHubViewType | null`
  - `extractRepoContext(url: string): RepoContext | null`
  - Blob URL parsing: `github.com/:owner/:repo/blob/:ref/:path`
  - PR files URL parsing: `github.com/:owner/:repo/pull/:id/files`
  - Compare URL parsing: `github.com/:owner/:repo/compare/:base...:head`
  - Returns `null` for non-code pages
  - Turbo navigation listener setup
  - Unit tests for all URL patterns including edge cases (nested paths, special characters)
  - `pnpm typecheck` passes

### P5-T2: DOM Observer

- **Status**: ⬜ TODO
- **Dependencies**: `P5-T1`
- **Outputs**: `src/content/dom-observer.ts`
- **Spec reference**: `openspec/specs/content-script/spec.md` (DOM Observation)
- **Description**: MutationObserver on the code container element. Detects line additions/removals from GitHub's virtualized rendering during scroll.
- **Acceptance criteria**:
  - `startObserving(container: Element): void` — sets up MutationObserver
  - `stopObserving(): void` — disconnects observer and cleans up
  - Callback for new code lines added to DOM
  - Callback for code lines removed from DOM
  - Handles GitHub's specific DOM structure (table rows with code cells)
  - Unit tests with simulated DOM mutations
  - `pnpm typecheck` passes

### P5-T3: Token Detector

- **Status**: ⬜ TODO
- **Dependencies**: `P5-T2`, `P1-T3`
- **Outputs**: `src/content/token-detector.ts`
- **Spec reference**: `openspec/specs/content-script/spec.md` (Token Detection)
- **Description**: Mouse hover handler with debouncing. Detects which code token the cursor is over, computes LSP position (line + character offset).
- **Acceptance criteria**:
  - `onTokenHover(callback: (context: TokenHoverContext) => void): void`
  - Debounce: configurable delay (default 300ms) before triggering
  - Cancels pending hover when mouse moves to different token or leaves code area
  - Position calculation: line number from DOM, character offset from cursor position
  - Text selection trigger on mouseup
  - Unit tests for: debounce logic, position calculation, cancellation
  - `pnpm typecheck` passes

### P5-T4: Messaging Layer

- **Status**: ⬜ TODO
- **Dependencies**: `P1-T2`
- **Outputs**: `src/content/messaging.ts`
- **Spec reference**: `openspec/specs/content-script/spec.md` (Communication with Background)
- **Description**: Content-script side messaging. Sends typed messages to background via `chrome.runtime.sendMessage`, handles responses, supports request cancellation.
- **Acceptance criteria**:
  - `sendHoverRequest(context: RepoContext, position: LspPosition): Promise<LspHoverResponse>`
  - `sendDefinitionRequest(...)`: Promise<LspDefinitionResponse>`
  - `cancelRequest(requestId: string): void` — sends cancel message
  - Automatic request ID generation
  - Timeout handling for unresponsive background
  - Unit tests with mocked `chrome.runtime`
  - `pnpm typecheck` passes

### P5-T5: Content Script Entry Point

- **Status**: ⬜ TODO
- **Dependencies**: `P5-T1`, `P5-T2`, `P5-T3`, `P5-T4`
- **Outputs**: `src/content/index.ts`
- **Spec reference**: `openspec/specs/content-script/spec.md`
- **Description**: Orchestrates page detection, DOM observation, token detection, and messaging. Handles init/teardown lifecycle for Turbo navigation.
- **Acceptance criteria**:
  - Activates on supported code pages, stays dormant on others
  - Reinitializes on Turbo navigation
  - Tears down observers and pending requests on navigation away
  - Sends `page/navigated` message to background on context change
  - Integration test for full content script lifecycle
  - `pnpm typecheck` passes

---

## Phase 6: UI Renderer — Popover

### P6-T1: Shadow DOM Mount

- **Status**: ⬜ TODO
- **Dependencies**: `P1-T1`
- **Outputs**: `src/ui/mount.ts`
- **Spec reference**: `openspec/specs/ui-renderer/spec.md` (Shadow DOM Isolation)
- **Description**: Create Shadow DOM root in GitHub page, inject extension styles, mount Preact app inside the shadow boundary.
- **Acceptance criteria**:
  - `createMount(): ShadowRoot` — creates shadow root with mode `open`
  - Injects CSS into shadow root
  - Preact renders inside shadow root
  - GitHub styles do NOT leak into shadow root
  - Extension styles do NOT leak into GitHub page
  - Unit test verifying style isolation
  - `pnpm typecheck` passes

### P6-T2: Popover Positioning

- **Status**: ⬜ TODO
- **Dependencies**: `P6-T1`
- **Outputs**: `src/ui/popover/positioning.ts`
- **Spec reference**: `openspec/specs/ui-renderer/spec.md` (Popover Positioning)
- **Description**: Compute popover position anchored to a token element. Handle viewport boundaries (flip above/below, shift horizontally), account for GitHub's sticky header.
- **Acceptance criteria**:
  - `calculatePosition(tokenRect: DOMRect, popoverSize: { width, height }, viewport: { width, height, scrollY }): PopoverPosition`
  - Default: below the token
  - Flips above when insufficient space below
  - Shifts horizontally to stay in viewport
  - Never overlaps the hovered token
  - Accounts for sticky header offset
  - Unit tests for all positioning scenarios (below, above, left-shift, right-shift)
  - `pnpm typecheck` passes

### P6-T3: Popover Component

- **Status**: ⬜ TODO
- **Dependencies**: `P6-T2`
- **Outputs**: `src/ui/popover/Popover.tsx`
- **Spec reference**: `openspec/specs/ui-renderer/spec.md` (Display Mode — Popover)
- **Description**: Preact component for the hover popover. Shows type signature, parameters, documentation, definition link. Handles dismissal (mouse-out, Escape, scroll), pin support, fade animation.
- **Acceptance criteria**:
  - Renders `HoverDisplayData` as structured content
  - Dismisses on: mouse leaves popover+token, Escape key, scroll >50px, navigation
  - Pinnable via keyboard shortcut (stays visible until explicitly closed)
  - Mouse hover on popover keeps it visible (for text selection, link clicking)
  - Scrollable when content exceeds max height
  - Fade-out animation (150ms, respects `prefers-reduced-motion`)
  - `pnpm typecheck` passes

### P6-T4: Display Subcomponents

- **Status**: ⬜ TODO
- **Dependencies**: `P6-T3`
- **Outputs**: `src/ui/components/SignatureDisplay.tsx`, `src/ui/components/MarkdownRenderer.tsx`, `src/ui/components/ParameterList.tsx`, `src/ui/components/DefinitionLink.tsx`, `src/ui/components/LoadingState.tsx`, `src/ui/components/ErrorState.tsx`
- **Spec reference**: `openspec/specs/ui-renderer/spec.md` (Content Rendering, Loading and Error States)
- **Description**: Individual Preact components for rendering different parts of the hover display.
- **Acceptance criteria**:
  - `SignatureDisplay`: Syntax-highlighted type/function signature, monospace font
  - `MarkdownRenderer`: Renders markdown documentation as HTML (code blocks, links, lists)
  - `ParameterList`: Structured display of parameter name, type, default, documentation
  - `DefinitionLink`: "Go to Definition" link — GitHub blob URL for same-repo, text for external
  - `LoadingState`: Pulsing skeleton shown after 200ms delay
  - `ErrorState`: Error message with retry button for `lsp_server_error`, dismissible message for `unsupported_language`
  - `pnpm typecheck` passes

### P6-T5: Theme Detection

- **Status**: ⬜ TODO
- **Dependencies**: `P6-T1`
- **Outputs**: `src/ui/styles/theme.css`, `src/ui/theme.ts`
- **Spec reference**: `openspec/specs/ui-renderer/spec.md` (Theme Support)
- **Description**: Detect GitHub's current theme (`data-color-mode` attribute on `<html>`), apply matching light/dark CSS variables.
- **Acceptance criteria**:
  - `detectTheme(): DetectedTheme` — reads GitHub's theme attribute
  - CSS variables for light and dark themes
  - Theme auto-updates when GitHub's theme changes (MutationObserver on `<html>` attributes)
  - Unit test for theme detection logic
  - `pnpm typecheck` passes

---

## Phase 7: UI Renderer — Sidebar

### P7-T1: Sidebar Component

- **Status**: ⬜ TODO
- **Dependencies**: `P6-T1`, `P6-T4`, `P6-T5`
- **Outputs**: `src/ui/sidebar/Sidebar.tsx`
- **Spec reference**: `openspec/specs/ui-renderer/spec.md` (Display Mode — Sidebar Panel)
- **Description**: Dockable sidebar panel (right/left/top/bottom). Renders the same content as popover but in a persistent panel. Collapse/expand with smooth transitions.
- **Acceptance criteria**:
  - Docks to configured position (right, left, top, bottom)
  - Collapse/expand toggle (button + keyboard shortcut)
  - Content updates on hover with smooth transition
  - Reuses display subcomponents from P6-T4
  - `pnpm typecheck` passes

### P7-T2: Resize Handler

- **Status**: ⬜ TODO
- **Dependencies**: `P7-T1`
- **Outputs**: `src/ui/sidebar/resize.ts`
- **Description**: Drag-to-resize the sidebar. Min 200px, max 50% of viewport.
- **Acceptance criteria**:
  - Drag handle at the edge of the sidebar
  - Resize within min/max bounds
  - Persists resize preference in settings
  - Unit test for bounds clamping logic
  - `pnpm typecheck` passes

### P7-T3: Sidebar Integration

- **Status**: ⬜ TODO
- **Dependencies**: `P7-T1`, `P7-T2`, `P5-T5`
- **Outputs**: Updates to `src/content/index.ts`
- **Description**: Wire sidebar display mode into the content script. Update sidebar on hover, respect display mode setting.
- **Acceptance criteria**:
  - Content script creates sidebar or popover based on `displayMode` setting
  - Sidebar updates when hover data arrives
  - Setting change (popover ↔ sidebar) applies without page reload
  - `pnpm typecheck` passes

---

## Phase 8: Extension Pages

### P8-T1: Popup Page

- **Status**: ⬜ TODO
- **Dependencies**: `P1-T4`, `P6-T5`
- **Outputs**: `src/pages/popup/main.tsx`, `src/pages/popup/index.html`
- **Spec reference**: `openspec/specs/extension-settings/spec.md` (Popup Page)
- **Description**: Compact popup showing extension status, toggles, and language indicator.
- **Acceptance criteria**:
  - Shows enabled/disabled toggle
  - Shows detected language for current page
  - Shows LSP server status
  - Quick toggle for display mode (popover/sidebar)
  - Link to full options page
  - Shows "Navigate to a GitHub code page" on non-GitHub pages
  - `pnpm typecheck` passes

### P8-T2: Options Page

- **Status**: ⬜ TODO
- **Dependencies**: `P1-T4`, `P6-T5`
- **Outputs**: `src/pages/options/main.tsx`, `src/pages/options/index.html`
- **Spec reference**: `openspec/specs/extension-settings/spec.md` (Options Page)
- **Description**: Full settings page: display mode, sidebar position, language toggles, PAT configuration, performance tuning.
- **Acceptance criteria**:
  - Display mode selection (popover/sidebar)
  - Sidebar position selection (right/left/top/bottom)
  - Language toggle switches for each supported language
  - GitHub PAT input with validation (test API call) and masked display
  - Performance settings: debounce (100-1000ms), cache TTL (1-60min), worker idle (1-30min), max workers (1-8)
  - Theme selection (auto/light/dark)
  - `pnpm typecheck` passes

### P8-T3: Settings Wiring

- **Status**: ⬜ TODO
- **Dependencies**: `P8-T1`, `P8-T2`, `P1-T4`
- **Outputs**: Updates to popup and options pages
- **Description**: Wire settings changes to `chrome.storage.sync` with auto-save. Propagate changes to active content scripts and background via `chrome.storage.onChanged`.
- **Acceptance criteria**:
  - Settings save automatically on change (no submit button)
  - Changes propagate to background and all active content scripts
  - Settings load on page open with current values
  - `pnpm typecheck` passes

### P8-T4: Keyboard Shortcut Handlers

- **Status**: ⬜ TODO
- **Dependencies**: `P2-T1`
- **Outputs**: Updates to `src/background/index.ts`
- **Spec reference**: `openspec/specs/extension-settings/spec.md` (Keyboard Shortcuts)
- **Description**: Handle `chrome.commands.onCommand` for toggle extension, toggle sidebar, pin popover.
- **Acceptance criteria**:
  - `Alt+Shift+L` toggles extension enabled/disabled
  - `Alt+Shift+S` toggles sidebar collapsed/expanded
  - `Alt+Shift+P` pins/unpins current popover
  - Commands forwarded to active content script tab
  - `pnpm typecheck` passes

---

## Phase 9: Cross-Browser Support

### P9-T1: WebExtension Polyfill Integration

- **Status**: ⬜ TODO
- **Dependencies**: `P8-T3` (all Chrome features complete)
- **Outputs**: Updates to all `chrome.*` API call sites
- **Description**: Integrate `webextension-polyfill` throughout the codebase to normalize Chrome and Safari API differences.
- **Acceptance criteria**:
  - All `chrome.*` calls replaced with `browser.*` (via polyfill)
  - Import `browser` from `webextension-polyfill` in all modules
  - `pnpm typecheck` passes

### P9-T2: Safari Build Step

- **Status**: ⬜ TODO
- **Dependencies**: `P9-T1`
- **Description**: Add build step using `safari-web-extension-converter` to produce an Xcode project from the Chrome extension output.
- **Acceptance criteria**:
  - `pnpm build:safari` script produces Xcode project
  - Build completes without errors
  - Manifest is Safari-compatible

### P9-T3: Safari Verification

- **Status**: ⬜ TODO
- **Dependencies**: `P9-T2`
- **Description**: Manual and automated verification that WASM loading and the full extension flow works in Safari.
- **Acceptance criteria**:
  - Extension loads in Safari
  - WASM servers load and respond
  - Hover popover displays correctly
  - Sidebar mode works
  - Settings persist

---

## Phase 10: Accessibility & Polish

### P10-T1: Accessibility

- **Status**: ⬜ TODO
- **Dependencies**: `P7-T3` (all UI complete)
- **Outputs**: Updates to all UI components
- **Spec reference**: `openspec/specs/ui-renderer/spec.md` (Accessibility)
- **Description**: Add ARIA attributes, keyboard focusability, screen reader support, reduced-motion respect.
- **Acceptance criteria**:
  - `role="tooltip"` on popover, `role="complementary"` on sidebar
  - `aria-label` on all interactive elements
  - `aria-live="polite"` on dynamic content regions
  - All interactive elements keyboard-focusable (Tab order)
  - `prefers-reduced-motion: reduce` disables/minimizes animations
  - `pnpm typecheck` passes

### P10-T2: Internationalization

- **Status**: ⬜ TODO
- **Dependencies**: `P10-T1`
- **Outputs**: `src/_locales/en/messages.json`
- **Description**: Extract all user-facing strings to `chrome.i18n` messages.
- **Acceptance criteria**:
  - All strings in popup, options, popover, sidebar use `chrome.i18n.getMessage()`
  - English locale file with all message definitions
  - `pnpm typecheck` passes

---

## Phase 11: End-to-End Testing

### P11-T1: E2E Test Setup

- **Status**: ⬜ TODO
- **Dependencies**: `P9-T1` (cross-browser support complete)
- **Outputs**: `playwright.config.ts`, `tests/e2e/fixtures/`
- **Description**: Set up Playwright with browser extension support. Create test fixtures for loading the extension in Chrome.
- **Acceptance criteria**:
  - Playwright configured to load the extension
  - Helper to navigate to a GitHub code page
  - Extension loads and activates in test browser
  - `pnpm test:e2e` script added

### P11-T2: E2E Test Suite

- **Status**: ⬜ TODO
- **Dependencies**: `P11-T1`
- **Outputs**: `tests/e2e/*.test.ts`
- **Description**: Write E2E tests covering critical user flows.
- **Acceptance criteria**:
  - Test: Hover on token shows popover with type info
  - Test: Sidebar mode shows type info in panel
  - Test: Extension toggle enables/disables
  - Test: Turbo navigation reinitializes extension
  - Test: Virtualized scroll (hover on newly rendered lines)
  - Test: PAT authentication increases rate limit
  - All tests pass in CI

---

## Phase 12: CI/CD & Release

### P12-T1: CI Pipeline

- **Status**: ⬜ TODO
- **Dependencies**: `P11-T2`
- **Outputs**: `.github/workflows/ci.yml`
- **Description**: GitHub Actions workflow for PR checks.
- **Acceptance criteria**:
  - Triggers on push and PR
  - Steps: install, lint, typecheck, test, build
  - Caches pnpm store
  - Reports test results

### P12-T2: Release Pipeline

- **Status**: ⬜ TODO
- **Dependencies**: `P12-T1`
- **Outputs**: `.github/workflows/release.yml`
- **Description**: GitHub Actions workflow for tagged releases.
- **Acceptance criteria**:
  - Triggers on version tag push (`v*.*.*`)
  - Builds Chrome `.zip` and Safari Xcode project
  - Creates GitHub Release with artifacts
  - Optionally submits to Chrome Web Store

---

## Critical Path (Shortest Path to First Working Hover)

The minimum viable path to a working hover popover on GitHub:

```
P0-T1 → P1-T1 → P1-T2 → P1-T3 → P1-T5
                                      ↓
        P2-T2 → P2-T3 → P2-T4 → P3-T1 → P3-T4 → P3-T5
                                      ↓
        P4-T1 → P4-T2              P5-T1 → P5-T2 → P5-T3 → P5-T4 → P5-T5
                  ↓                                                      ↓
              P6-T1 → P6-T2 → P6-T3 → P6-T4 → P6-T5
```

**Estimated minimum tasks for first hover**: ~20 tasks across 6 phases.
