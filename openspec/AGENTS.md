# AGENTS.md — AI Agent Instructions for gh-lsp

<openspec-instructions>

## Project Overview

This project (`gh-lsp`) is a cross-browser extension (Chrome + Safari) that provides Language Server Protocol (LSP) powered code intelligence on GitHub.com. When a user hovers over or selects a symbol in GitHub's code view, the extension displays type definitions, function signatures, parameter info, and go-to-definition links in a popover or configurable sidebar panel.

## Workflow

1. Read `openspec/project.md` for global context, tech stack, and constraints.
2. Read relevant specs under `openspec/specs/` before making any changes.
3. When implementing a change, follow `openspec/changes/<change-id>/tasks.md` sequentially.
4. Reference `openspec/changes/<change-id>/proposal.md` and delta specs as inviolable specifications.
5. After implementation, update task status markers in `tasks.md`.

## Coding Standards

- TypeScript strict mode, no `any` types unless interfacing with external untyped APIs.
- Use ES modules throughout.
- Chrome extension: Manifest V3. Safari extension: Web Extension API via Xcode conversion.
- All LSP communication uses JSON-RPC 2.0 over in-memory message passing (postMessage to Web Workers).
- UI components: Preact (lightweight, <4KB) for popover and sidebar rendering.
- Testing: Vitest for unit tests, Playwright for E2E browser extension tests.
- All user-facing strings must be localizable via `chrome.i18n` / `browser.i18n`.

## Architecture Constraints

- Content scripts run in GitHub page context; LSP servers run in Web Workers (or WASM in Web Workers).
- The background service worker orchestrates lifecycle: activating/deactivating LSP servers per language, managing worker pools.
- GitHub's code view uses React with **virtualized rendering** — only visible lines exist in the DOM. Content scripts MUST use `MutationObserver` to detect new code lines as the user scrolls.
- Never modify GitHub's existing DOM structure; only overlay/inject extension UI elements.
- Extension must degrade gracefully when LSP server is unavailable for a language — show "unsupported language" instead of errors.

## File Naming Conventions

- Specs: `openspec/specs/<module>/spec.md`
- Changes: `openspec/changes/<change-name>/{proposal.md,design.md,tasks.md,specs/}`
- Source: `src/` with subdirectories `content/`, `background/`, `workers/`, `ui/`, `lsp/`, `shared/`

</openspec-instructions>
