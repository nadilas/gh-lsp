# Extension Settings — Specification

## Overview

The extension settings system provides a popup page and options page where users can configure the extension's behavior, including display mode, panel position, enabled languages, authentication, and performance tuning.

---

## Requirement: Settings Storage

Settings SHALL be persisted using `chrome.storage.sync` for cross-device synchronization.

#### Scenario: Default Settings
- **GIVEN** the extension is installed for the first time
- **WHEN** no settings have been saved
- **THEN** the following defaults SHALL apply:
  - `displayMode`: `"popover"`
  - `sidebarPosition`: `"right"`
  - `hoverDebounceMs`: `300`
  - `enabledLanguages`: `["typescript", "javascript", "go", "rust", "python"]`
  - `githubPat`: `""` (empty, unauthenticated)
  - `cacheTimeoutMinutes`: `10`
  - `workerIdleTimeoutMinutes`: `5`
  - `maxConcurrentWorkers`: `4`
  - `theme`: `"auto"` (match GitHub)
  - `showLoadingIndicator`: `true`
  - `keyboardShortcutToggle`: `"Alt+Shift+L"`

#### Scenario: Save Settings
- **GIVEN** the user modifies a setting in the options page
- **WHEN** the setting is changed
- **THEN** the new value SHALL be persisted to `chrome.storage.sync` immediately (auto-save, no submit button)

#### Scenario: Settings Change Propagation
- **GIVEN** a setting is modified
- **WHEN** the new value is saved
- **THEN** all active content scripts and the background service worker SHALL be notified of the change via `chrome.storage.onChanged` and apply it without requiring a page refresh

---

## Requirement: Options Page

The extension SHALL provide an options page accessible from the extension's popup and Chrome's extension management page.

#### Scenario: Display Mode Selection
- **GIVEN** the user opens the options page
- **WHEN** they configure the display mode
- **THEN** they SHALL be able to choose between:
  - **Popover** (default): Floating tooltip near the hovered token
  - **Sidebar**: Persistent panel docked to the code view

#### Scenario: Sidebar Position Selection
- **GIVEN** the user has selected "Sidebar" display mode
- **WHEN** they configure the sidebar position
- **THEN** they SHALL be able to choose: Right, Left, Top, or Bottom

#### Scenario: Language Toggle
- **GIVEN** the user opens the options page
- **WHEN** they view the language settings
- **THEN** they SHALL see a list of all available languages with toggle switches to enable/disable each one

#### Scenario: GitHub PAT Configuration
- **GIVEN** the user opens the options page
- **WHEN** they enter a GitHub Personal Access Token
- **THEN** the token SHALL be:
  1. Validated by making a test API call to `GET /user`
  2. Stored securely in `chrome.storage.local` (NOT sync, for security)
  3. Displayed as masked (`ghp_****...****`) after saving

#### Scenario: Performance Tuning
- **GIVEN** the user opens the advanced settings section
- **WHEN** they adjust performance settings
- **THEN** they SHALL be able to configure:
  - Hover debounce delay (100ms–1000ms)
  - Cache timeout (1–60 minutes)
  - Worker idle timeout (1–30 minutes)
  - Maximum concurrent workers (1–8)

---

## Requirement: Popup Page

The extension SHALL provide a compact popup accessible by clicking the extension icon.

#### Scenario: Quick Status View
- **GIVEN** the user clicks the extension icon while on a GitHub code page
- **WHEN** the popup opens
- **THEN** it SHALL display:
  - Extension enabled/disabled toggle
  - Current language detected for the page
  - LSP server status (running, loading, idle, error)
  - Quick toggle for display mode (popover/sidebar)
  - Link to full options page

#### Scenario: Non-GitHub Page
- **GIVEN** the user clicks the extension icon on a non-GitHub page
- **WHEN** the popup opens
- **THEN** it SHALL display a message: "Navigate to a GitHub code page to use gh-lsp"

#### Scenario: Extension Enable/Disable
- **GIVEN** the popup is open
- **WHEN** the user toggles the extension off
- **THEN** all content scripts SHALL deactivate, all workers SHALL be terminated, and the extension icon SHALL show a disabled state

---

## Requirement: Keyboard Shortcuts

The extension SHALL support configurable keyboard shortcuts.

#### Scenario: Toggle Extension
- **GIVEN** the user presses the configured toggle shortcut (default: `Alt+Shift+L`)
- **WHEN** the shortcut is detected
- **THEN** the extension SHALL toggle between enabled and disabled states on the current page

#### Scenario: Toggle Sidebar
- **GIVEN** the sidebar is the active display mode
- **WHEN** the user presses the sidebar toggle shortcut (default: `Alt+Shift+S`)
- **THEN** the sidebar SHALL toggle between collapsed and expanded states

#### Scenario: Pin Popover
- **GIVEN** a popover is currently displayed
- **WHEN** the user presses the pin shortcut (default: `Alt+Shift+P`)
- **THEN** the popover SHALL become "pinned" and remain visible until explicitly dismissed, even when the mouse moves away
