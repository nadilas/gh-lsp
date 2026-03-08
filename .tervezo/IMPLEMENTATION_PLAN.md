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
- [ ] Create message protocol (`src/shared/messages.ts`): typed message schemas for content-to-background communication
- [ ] Create constants (`src/shared/constants.ts`): debounce defaults, cache TTLs, worker limits
- [ ] Create settings schema with defaults (`src/shared/settings.ts`): read/write helpers using `chrome.storage.sync`
- [ ] Create language registry (`src/shared/languages.ts`): file extension to language ID mapping, WASM binary paths

### Phase 2: Background Service Worker — Core

- [ ] Implement background entry point (`src/background/index.ts`): message listener setup, initialization
- [ ] Implement GitHub API client (`src/background/github-api.ts`): authenticated/unauthenticated requests, rate limit handling with exponential backoff, file content fetching
- [ ] Implement response cache (`src/background/cache.ts`): LRU cache with TTL, keyed by repo/ref/file/position, invalidation on ref change
- [ ] Implement document sync (`src/background/document-sync.ts`): fetch file content from GitHub API or cache, manage `textDocument/didOpen` notifications
- [ ] Write unit tests for GitHub API client and cache

### Phase 3: LSP Worker Infrastructure

- [ ] Implement JSON-RPC 2.0 transport (`src/workers/lsp-worker.ts`): postMessage-based request/response/notification handling, error codes
- [ ] Implement virtual file system (`src/workers/vfs.ts`): in-memory file storage, URI-based lookup, file request notification
- [ ] Implement language registry (`src/workers/language-registry.ts`): WASM binary loader, capability declarations per language
- [ ] Implement worker pool manager (`src/background/worker-pool.ts`): spawn/reuse/evict workers, idle timeout, max concurrency, crash recovery
- [ ] Implement LSP router (`src/background/lsp-router.ts`): language detection from file extension, request routing to correct worker, response forwarding
- [ ] Write unit tests for JSON-RPC transport, VFS, worker pool, and LSP router

### Phase 4: WASM Language Server Integration

- [ ] Research and source/compile TypeScript language server to WASM (or integrate existing WASM build)
- [ ] Create WASM loader for TypeScript server — initialize, configure capabilities, test hover/definition
- [ ] Research Go, Rust, Python language servers compiled to WASM
- [ ] Create integration tests for WASM server lifecycle and hover responses

### Phase 5: Content Script

- [ ] Implement page detector (`src/content/page-detector.ts`): URL pattern matching for blob, PR files, compare views; Turbo navigation detection
- [ ] Implement DOM observer (`src/content/dom-observer.ts`): MutationObserver setup on code container, detect line additions/removals
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
