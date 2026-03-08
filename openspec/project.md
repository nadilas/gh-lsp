# gh-lsp — Project Context

## Project Name
gh-lsp: GitHub Code Intelligence Browser Extension with LSP Hover

## Description
A Chrome and Safari browser extension that brings IDE-level code intelligence to GitHub's web-based code viewer. The extension runs language servers (via WebAssembly in Web Workers) to provide hover information, type definitions, function signatures, and go-to-definition navigation for code viewed on github.com.

## Technology Stack

| Layer | Technology | Version / Notes |
|---|---|---|
| Language | TypeScript | 5.x, strict mode |
| Module System | ES Modules | Native ESM throughout |
| Build Tool | Vite | 6.x with `@crxjs/vite-plugin` for Chrome, custom build for Safari |
| UI Framework | Preact | 10.x (<4KB gzipped, ideal for extension overlay UI) |
| Styling | CSS Modules | Scoped styles to avoid GitHub CSS conflicts |
| Testing (Unit) | Vitest | 3.x |
| Testing (E2E) | Playwright | Latest, with browser extension support |
| Chrome Extension | Manifest V3 | Service worker based |
| Safari Extension | Web Extension API | Via Xcode `safari-web-extension-converter` |
| LSP Transport | JSON-RPC 2.0 | Over `postMessage` to Web Workers |
| LSP Servers | WASM-compiled | Per-language servers compiled to WebAssembly |
| Package Manager | pnpm | 9.x |
| Linting | ESLint + Prettier | Flat config |
| CI | GitHub Actions | Build, test, lint on push |

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    GitHub.com Page                       │
│  ┌───────────────────────────────────────────────────┐  │
│  │              Content Script Layer                  │  │
│  │  ┌─────────────┐  ┌──────────┐  ┌─────────────┐  │  │
│  │  │ DOM Observer │  │ Token    │  │ UI Renderer │  │  │
│  │  │ (MutationObs)│  │ Detector │  │ (Preact)    │  │  │
│  │  └──────┬──────┘  └────┬─────┘  └──────┬──────┘  │  │
│  │         │              │               │          │  │
│  │         └──────────────┼───────────────┘          │  │
│  │                        │ messages                 │  │
│  └────────────────────────┼──────────────────────────┘  │
│                           │                             │
├───────────────────────────┼─────────────────────────────┤
│         Background Service Worker                       │
│  ┌────────────────────────┼──────────────────────────┐  │
│  │  ┌─────────────┐  ┌───┴──────┐  ┌─────────────┐  │  │
│  │  │ LSP Router  │  │ Worker   │  │ Cache       │  │  │
│  │  │ & Lifecycle │  │ Pool Mgr │  │ Manager     │  │  │
│  │  └──────┬──────┘  └────┬─────┘  └─────────────┘  │  │
│  │         │              │                          │  │
│  └─────────┼──────────────┼──────────────────────────┘  │
│            │              │                             │
├────────────┼──────────────┼─────────────────────────────┤
│            │   Web Workers (per language)                │
│  ┌─────────┴──────────────┴──────────────────────────┐  │
│  │  ┌──────────────┐  ┌──────────────┐               │  │
│  │  │ TS LSP       │  │ Go LSP       │  ...          │  │
│  │  │ (WASM)       │  │ (WASM)       │               │  │
│  │  └──────────────┘  └──────────────┘               │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## Supported GitHub Views

The extension SHALL activate on:
- **Blob view**: `github.com/<owner>/<repo>/blob/<ref>/<path>`
- **Pull request file view**: `github.com/<owner>/<repo>/pull/<id>/files`
- **Compare view**: `github.com/<owner>/<repo>/compare/<base>...<head>`

## Domain Knowledge

### GitHub Code View Internals
- GitHub renders code using React with **virtualized line rendering** — only lines visible in the viewport exist in the DOM at any time.
- Code lines use `<div>` elements with syntax-highlighted `<span>` children. CSS class names are minified and change across deployments.
- The extension MUST use `MutationObserver` on the code container to detect line additions/removals during scroll.
- GitHub uses `turbo` (Hotwire Turbo) for SPA-like navigation; the extension MUST detect page transitions and reinitialize.

### LSP Protocol (Relevant Subset)
- `initialize` / `initialized`: Handshake, capability negotiation.
- `textDocument/didOpen`: Notify server of file content.
- `textDocument/hover`: Request hover info at a position → returns `MarkupContent` (markdown/plaintext).
- `textDocument/definition`: Request go-to-definition → returns `Location[]`.
- `textDocument/signatureHelp`: Request function signature info.

### Browser Extension Architecture (Manifest V3)
- **Content scripts**: Injected into GitHub pages, read/modify DOM, communicate with background via `chrome.runtime.sendMessage`.
- **Background service worker**: Persistent-ish process, manages Web Workers for LSP servers, caches results.
- **Web Workers**: Run WASM-compiled LSP servers, communicate via `postMessage` JSON-RPC.
- **Popup/Options page**: Extension settings (panel position, enabled languages, theme).

## Constraints

- Extension MUST NOT degrade GitHub page performance by more than 50ms on initial load.
- LSP server WASM binaries MUST be lazy-loaded only when the corresponding language is detected.
- All network requests for fetching additional source files (for cross-file resolution) MUST go through GitHub's API with the user's existing session or a configured PAT.
- The extension MUST respect GitHub's rate limits and implement exponential backoff.
- Hover popover MUST appear within 200ms of hover stabilization for cached results, 500ms for uncached.
- Extension storage for settings MUST use `chrome.storage.sync` for cross-device sync.
