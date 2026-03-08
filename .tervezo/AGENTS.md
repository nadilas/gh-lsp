# AGENTS.md — Operational Instructions

## Project

gh-lsp: GitHub Code Intelligence Browser Extension with LSP Hover

## Tech Stack

- TypeScript 5.x (strict mode)
- Preact 10.x for UI
- Vite 6.x with @crxjs/vite-plugin
- Vitest 3.x for unit tests
- Playwright for E2E tests
- pnpm 9.x package manager
- Chrome Manifest V3

## Commands

- `pnpm install` — Install dependencies
- `pnpm dev` — Start dev server with HMR
- `pnpm build` — Production build
- `pnpm test` — Run unit tests (vitest)
- `pnpm lint` — Run ESLint
- `pnpm typecheck` — Run tsc --noEmit

## Key Architecture Decisions

- Preact over React (<4KB gzipped)
- Shadow DOM for all injected UI (prevent CSS conflicts with GitHub)
- MutationObserver for DOM tracking (GitHub virtualizes code lines)
- Web Workers + WASM for LSP servers (off main thread)
- JSON-RPC 2.0 over postMessage (standard LSP transport)
- Vite + @crxjs/vite-plugin for Chrome builds

## Directory Structure

```
src/
  manifest.json          — Chrome Manifest V3
  content/               — Content script (GitHub DOM interaction)
  background/            — Background service worker
  workers/               — Web Workers for LSP servers
  ui/                    — Preact UI components (popover, sidebar)
  pages/                 — Extension popup and options pages
  shared/                — Shared types, constants, messages
  lsp/wasm/              — WASM language server binaries
openspec/                — OpenSpec behavioral specifications
  specs/                 — Per-module GIVEN/WHEN/THEN specs
tests/
  unit/                  — Vitest unit tests
  e2e/                   — Playwright E2E tests
```

## Specs Location

All behavioral specs are in `openspec/specs/<module>/spec.md`. Read the relevant spec before implementing any module.
