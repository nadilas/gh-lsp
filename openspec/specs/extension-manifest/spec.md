# Extension Manifest & Build — Specification

## Overview

This spec covers the Chrome Manifest V3 configuration, Safari Web Extension conversion, and the build pipeline that produces distributable extension packages for both browsers.

---

## Requirement: Chrome Manifest V3

The extension SHALL use a valid Chrome Manifest V3 configuration.

#### Scenario: Manifest Structure
- **GIVEN** the extension is being packaged for Chrome
- **WHEN** the build runs
- **THEN** the `manifest.json` SHALL include:
  - `manifest_version`: `3`
  - `name`: `"gh-lsp — GitHub Code Intelligence"`
  - `description`: A concise description of the extension's purpose
  - `version`: Semver version string
  - `permissions`: `["storage", "activeTab"]`
  - `optional_permissions`: `[]`
  - `host_permissions`: `["https://github.com/*", "https://api.github.com/*"]`
  - `background.service_worker`: Path to the background script
  - `content_scripts`: Array with `matches: ["https://github.com/*"]`, `js`, and `css` entries
  - `action`: Popup page configuration
  - `options_page`: Options page path
  - `icons`: 16, 32, 48, 128px icon variants
  - `commands`: Keyboard shortcut definitions

#### Scenario: Content Security Policy
- **GIVEN** the extension loads WASM modules
- **WHEN** the manifest is generated
- **THEN** the `content_security_policy.extension_pages` SHALL include `wasm-unsafe-eval` to allow WASM execution in the extension context

#### Scenario: Web Accessible Resources
- **GIVEN** the content script needs to load extension assets (icons, fonts)
- **WHEN** the manifest is generated
- **THEN** `web_accessible_resources` SHALL list required assets with `matches: ["https://github.com/*"]`

---

## Requirement: Safari Web Extension

The extension SHALL be convertible to a Safari Web Extension.

#### Scenario: Safari Conversion
- **GIVEN** the Chrome extension is built
- **WHEN** the Safari build step runs
- **THEN** the build pipeline SHALL:
  1. Use `safari-web-extension-converter` to create an Xcode project
  2. Adjust any Chrome-specific APIs to use the `browser.*` namespace (via polyfill or build-time replacement)
  3. Produce a `.app` bundle containing the Safari Web Extension

#### Scenario: API Compatibility
- **GIVEN** the extension uses Chrome extension APIs
- **WHEN** building for Safari
- **THEN** the build SHALL ensure compatibility by:
  - Using `webextension-polyfill` to normalize API differences
  - Avoiding Chrome-only APIs that have no Safari equivalent
  - Testing all features in both Safari and Chrome

---

## Requirement: Build Pipeline

The extension SHALL have an automated build pipeline.

#### Scenario: Development Build
- **GIVEN** a developer runs `pnpm dev`
- **WHEN** the dev server starts
- **THEN** it SHALL:
  - Build the extension with source maps and HMR where possible
  - Output to `dist/chrome/` directory
  - Watch for file changes and rebuild incrementally

#### Scenario: Production Build
- **GIVEN** a developer runs `pnpm build`
- **WHEN** the build completes
- **THEN** it SHALL:
  - Output minified Chrome extension to `dist/chrome/`
  - Output Safari extension project to `dist/safari/`
  - Generate source maps (separate files, not inline)
  - Produce a `.zip` package ready for Chrome Web Store submission

#### Scenario: WASM Binary Management
- **GIVEN** WASM language server binaries are large (potentially several MB each)
- **WHEN** the extension is built
- **THEN** WASM binaries SHALL be:
  - Stored in `src/lsp/wasm/` during development
  - Copied to the output directory as-is (not bundled into JS)
  - Loaded lazily at runtime only when the corresponding language is needed
  - Listed in `web_accessible_resources` for content script access

---

## Requirement: CI/CD

The extension SHALL have CI/CD configuration.

#### Scenario: PR Checks
- **GIVEN** a pull request is opened
- **WHEN** the CI pipeline runs
- **THEN** it SHALL:
  1. Install dependencies (`pnpm install`)
  2. Run linting (`pnpm lint`)
  3. Run type checking (`pnpm typecheck`)
  4. Run unit tests (`pnpm test`)
  5. Build the extension (`pnpm build`)
  6. Optionally run E2E tests

#### Scenario: Release Build
- **GIVEN** a version tag is pushed (e.g., `v1.0.0`)
- **WHEN** the release pipeline runs
- **THEN** it SHALL:
  1. Build production bundles for Chrome and Safari
  2. Create a GitHub Release with the `.zip` artifacts
  3. (Future) Auto-submit to Chrome Web Store via API
