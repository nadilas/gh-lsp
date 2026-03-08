# Implementation Plan: gh-lsp — GitHub Code Intelligence Browser Extension

## Overview

This project delivers a Chrome and Safari browser extension that provides LSP-powered code intelligence (hover type info, go-to-definition, signature help) on GitHub's web code views.

### Architecture

```
Content Script (GitHub DOM) <-> Background Service Worker <-> Web Workers (WASM LSP servers)
         |                            |
    UI Renderer (Preact)       GitHub REST API (file fetching)
```

## Task List

### Phase 0: Project Scaffolding

- [x] Initialize project with `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `vite.config.ts`, `eslint.config.js`, `.prettierrc`, `.gitignore`, and `src/manifest.json` (Manifest V3)

### Phase 1: Shared Foundations

- [x] Create shared TypeScript types (`src/shared/types.ts`): LSP message types, extension message types, settings types, language definitions
- [x] Create message protocol (`src/shared/messages.ts`): typed message schemas for content-to-background communication
- [x] Create constants (`src/shared/constants.ts`): debounce defaults, cache TTLs, worker limits
- [x] Create settings schema with defaults (`src/shared/settings.ts`): read/write helpers using `chrome.storage.sync`
- [x] Create language registry (`src/shared/languages.ts`): file extension to language ID mapping, WASM binary paths

### Phase 2: Background Service Worker — Core

- [x] Implement background entry point (`src/background/index.ts`): message listener setup, initialization
- [x] Implement GitHub API client (`src/background/github-api.ts`): authenticated/unauthenticated requests, rate limit handling with exponential backoff, file content fetching
- [x] Implement response cache (`src/background/cache.ts`): LRU cache with TTL, keyed by repo/ref/file/position, invalidation on ref change
- [x] Implement document sync (`src/background/document-sync.ts`): fetch file content from GitHub API or cache, manage `textDocument/didOpen` notifications
- [x] Write unit tests for GitHub API client and cache

### Phase 3: LSP Worker Infrastructure

- [x] Implement JSON-RPC 2.0 transport (`src/workers/lsp-worker.ts`): postMessage-based request/response/notification handling, error codes
- [x] Implement virtual file system (`src/workers/vfs.ts`): in-memory file storage, URI-based lookup, file request notification
- [x] Implement language registry (`src/workers/language-registry.ts`): WASM binary loader, capability declarations per language
- [x] Implement worker pool manager (`src/background/worker-pool.ts`): spawn/reuse/evict workers, idle timeout, max concurrency, crash recovery
- [x] Implement LSP router (`src/background/lsp-router.ts`): language detection from file extension, request routing to correct worker, response forwarding
- [x] Write unit tests for JSON-RPC transport, VFS, worker pool, and LSP router

### Phase 4: WASM Language Server Integration

- [x] Research and source/compile TypeScript language server to WASM (or integrate existing WASM build)
- [x] Create WASM loader for TypeScript server — initialize, configure capabilities, test hover/definition
- [x] Research Go, Rust, Python language servers compiled to WASM
- [x] Create integration tests for WASM server lifecycle and hover responses

### Phase 5: Content Script

- [x] Implement page detector (`src/content/page-detector.ts`): URL pattern matching for blob, PR files, compare views; Turbo navigation detection
- [x] Implement DOM observer (`src/content/dom-observer.ts`): MutationObserver setup on code container, detect line additions/removals
- [ ] Implement token detector (`src/content/token-detector.ts`): hover debouncing, mouse event handling, position calculation (line + character offset)
- [ ] Implement messaging layer (`src/content/messaging.ts`): typed message sending to background, response handling, request cancellation
- [ ] Implement content script entry point (`src/content/index.ts`): orchestrate page detection, DOM observation, token detection, messaging
- [ ] Write unit tests for page detector and token detector

### Phase 6: UI Renderer — Popover

- [ ] Implement Shadow DOM mount (`src/ui/mount.ts`): create shadow root, inject styles, mount Preact app
- [ ] Implement popover positioning (`src/ui/popover/positioning.ts`): anchor to token, viewport boundary detection, flip/shift logic
- [ ] Implement Popover component (`src/ui/popover/Popover.tsx`): display hover content, dismiss on mouse-out/Escape/scroll, pin support
- [ ] Implement display components: SignatureDisplay, MarkdownRenderer, ParameterList, DefinitionLink, LoadingState, ErrorState
- [ ] Implement theme detection and CSS variables (`src/ui/styles/theme.css`)
- [ ] Write unit tests for popover positioning logic

### Phase 7: UI Renderer — Sidebar

- [ ] Implement Sidebar component (`src/ui/sidebar/Sidebar.tsx`): dockable panel (right/left/top/bottom), collapse/expand, smooth transitions
- [ ] Implement resize handler (`src/ui/sidebar/resize.ts`): drag-to-resize with min/max bounds
- [ ] Integrate sidebar with content script: update on hover, respect display mode setting

### Phase 8: Extension Pages

- [ ] Implement Popup page (`src/pages/popup/`): status display, quick toggles, language indicator, link to options
- [ ] Implement Options page (`src/pages/options/`): display mode, sidebar position, language toggles, PAT configuration, performance settings
- [ ] Wire settings changes to `chrome.storage.sync` with auto-save and live propagation via `chrome.storage.onChanged`
- [ ] Implement keyboard shortcut handlers (toggle extension, toggle sidebar, pin popover)

### Phase 9: Cross-Browser Support

- [ ] Add `webextension-polyfill` for API normalization
- [ ] Create Safari build step using `safari-web-extension-converter`
- [ ] Verify WASM loading and full extension flow in Safari

### Phase 10: Accessibility & Polish

- [ ] Add ARIA attributes to popover and sidebar
- [ ] Ensure keyboard focusability for all interactive elements
- [ ] Implement `prefers-reduced-motion` respect and `chrome.i18n` support

### Phase 11: End-to-End Testing

- [ ] Set up Playwright for browser extension E2E testing
- [ ] Write E2E tests: hover popover, sidebar mode, extension toggle, Turbo navigation, virtualized scroll, PAT authentication

### Phase 12: CI/CD & Release

- [ ] Create `.github/workflows/ci.yml`: install, lint, typecheck, test, build
- [ ] Create `.github/workflows/release.yml`: build Chrome .zip + Safari project on tag push
- [ ] Final manual testing and Chrome Web Store submission preparation

## Learnings

- `jsdom` was missing as a devDependency despite being configured as the vitest test environment. Added in Phase 0 completion.
- `pnpm lint` fails when `tests/` directory doesn't exist. Will be resolved when first test files are created.
- `src/shared/types.ts` contains ~60 named types/interfaces covering: LSP protocol (Position, Range, Location, Hover, SignatureHelp, capabilities, lifecycle), JSON-RPC 2.0 transport, extension messages (discriminated union of 13 message types), worker messages, error codes, settings schema, UI state, popup state, GitHub API types, and cache types.
- **Phase 4-T1 Research**: TypeScript's Language Service API is JavaScript-based — no WASM compilation needed. It runs directly in a Web Worker via `ts.createLanguageService()` with a custom `LanguageServiceHost` backed by the VFS. The server adapter translates LSP methods to TS API calls: `getQuickInfoAtPosition` (hover), `getDefinitionAtPosition` (definition), `getSignatureHelpItems` (signature help). A minimal lib.d.ts (~300 lines) is embedded to provide essential built-in types (Array, Promise, Map, Set, etc.) without bundling the full 20K-line lib.es5.d.ts. Position conversion between LSP (line/character) and TypeScript (offset) is handled by `positionToOffset`/`offsetToPosition`. The same server adapter handles both TypeScript and JavaScript (via `allowJs`/`checkJs`).
- **Phase 4-T3 Research**: Go (gopls) has no WASM build — it's a native Go binary with heavy system dependencies. Rust (rust-analyzer) has an experimental WASM build at `github.com/rust-analyzer/rust-analyzer-wasm` (~10MB+). Python has two viable paths: Pyright is TypeScript-based and can run in a Web Worker (see `monaco-pyright-lsp`); Jedi/Pylsp require a Python runtime (possible via Pyodide but heavy). Currently only TypeScript/JavaScript servers are available. Added `server-availability.ts` with `isServerAvailable()`, `getWorkerUrl()`, and `getUnavailableReason()`. The LspRouter now checks availability before spawning workers, returning descriptive error messages for unavailable languages.
