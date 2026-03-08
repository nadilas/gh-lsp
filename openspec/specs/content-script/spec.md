# Content Script — Specification

## Overview

The content script is the primary interface between the extension and GitHub's web page. It observes the DOM for code elements, detects hover/selection events on tokens, communicates with the background service worker to request LSP information, and renders the resulting UI (popover or sidebar panel).

---

## Requirement: GitHub Page Detection

The content script SHALL detect when the user is viewing a supported GitHub code page and activate accordingly.

#### Scenario: Blob View Activation
- **GIVEN** the user navigates to a URL matching `github.com/<owner>/<repo>/blob/<ref>/<path>`
- **WHEN** the page DOM is fully loaded or Turbo navigation completes
- **THEN** the content script SHALL initialize the DOM observer and token detector for the code view

#### Scenario: Pull Request Files View Activation
- **GIVEN** the user navigates to a URL matching `github.com/<owner>/<repo>/pull/<id>/files`
- **WHEN** the page DOM is fully loaded or Turbo navigation completes
- **THEN** the content script SHALL initialize for each file diff panel visible on the page

#### Scenario: Compare View Activation
- **GIVEN** the user navigates to a URL matching `github.com/<owner>/<repo>/compare/<base>...<head>`
- **WHEN** the page DOM is fully loaded or Turbo navigation completes
- **THEN** the content script SHALL initialize for each file diff panel visible on the page

#### Scenario: SPA Navigation Handling
- **GIVEN** the content script is already active on a GitHub page
- **WHEN** GitHub performs a Turbo (SPA) navigation to another code view
- **THEN** the content script SHALL tear down existing observers and reinitialize for the new page

#### Scenario: Non-Code Page
- **GIVEN** the user navigates to a GitHub page that is NOT a code view (e.g., Issues, Settings)
- **WHEN** the page loads
- **THEN** the content script SHALL remain dormant and consume no resources

---

## Requirement: DOM Observation for Virtualized Code Lines

The content script SHALL observe GitHub's virtualized code rendering and maintain awareness of which code lines are currently in the DOM.

#### Scenario: Initial Code Lines
- **GIVEN** a supported code view has loaded
- **WHEN** the initial set of code lines is rendered in the DOM
- **THEN** the content script SHALL register hover/click event listeners on all rendered code token elements

#### Scenario: Scroll Reveals New Lines
- **GIVEN** the user scrolls through a code file
- **WHEN** GitHub's virtualizer adds new line elements to the DOM
- **THEN** the `MutationObserver` SHALL detect the additions and register hover/click event listeners on the new token elements

#### Scenario: Scroll Removes Lines
- **GIVEN** the user scrolls through a code file
- **WHEN** GitHub's virtualizer removes line elements from the DOM
- **THEN** the content script SHALL clean up any event listeners and pending hover timers for the removed elements

---

## Requirement: Token Detection and Hover Triggering

The content script SHALL detect when the user hovers over or selects a code token and translate the DOM position to an LSP-compatible text position.

#### Scenario: Mouse Hover on Token
- **GIVEN** the user's mouse cursor enters a code token element (a `<span>` within a code line)
- **WHEN** the cursor remains stationary for a configurable debounce period (default: 300ms)
- **THEN** the content script SHALL compute the LSP position (line number, character offset) and send a hover request to the background service worker

#### Scenario: Mouse Leaves Token Before Debounce
- **GIVEN** the user's mouse cursor enters a code token element
- **WHEN** the cursor leaves the element before the debounce period elapses
- **THEN** the content script SHALL cancel the pending hover request

#### Scenario: Text Selection Trigger
- **GIVEN** the user selects (highlights) a token or identifier in the code view
- **WHEN** the selection is completed (mouseup event)
- **THEN** the content script SHALL compute the LSP position range and send a hover request for the start position

#### Scenario: Position Calculation
- **GIVEN** a code token element in the DOM
- **WHEN** a hover or selection event occurs on it
- **THEN** the content script SHALL determine:
  - The **line number** from the line element's data attributes or DOM position
  - The **character offset** by counting characters from the start of the line to the cursor/selection position
  - The **file path** from the page URL or DOM metadata
  - The **repository**, **owner**, and **ref** (branch/commit) from the page URL

---

## Requirement: Communication with Background Service Worker

The content script SHALL communicate with the background service worker using `chrome.runtime.sendMessage` / `browser.runtime.sendMessage`.

#### Scenario: Send Hover Request
- **GIVEN** a hover event has been triggered on a code token
- **WHEN** the content script has computed the LSP position
- **THEN** the content script SHALL send a message of type `lsp/hover` with payload `{ repo, owner, ref, filePath, position: { line, character } }` to the background service worker

#### Scenario: Receive Hover Response
- **GIVEN** a hover request has been sent to the background service worker
- **WHEN** the background responds with hover data
- **THEN** the content script SHALL pass the response to the UI renderer for display

#### Scenario: Receive Error Response
- **GIVEN** a hover request has been sent to the background service worker
- **WHEN** the background responds with an error (e.g., unsupported language, LSP timeout)
- **THEN** the content script SHALL either show a minimal error indicator or silently ignore, depending on the error type

#### Scenario: Request Cancellation
- **GIVEN** a hover request is in-flight to the background service worker
- **WHEN** the user moves to a different token or the page navigates away
- **THEN** the content script SHALL send a cancellation message and ignore the stale response

---

## Requirement: File Metadata Extraction

The content script SHALL extract file and repository metadata from the GitHub page.

#### Scenario: Blob View Metadata
- **GIVEN** the user is on a blob view page
- **WHEN** the content script initializes
- **THEN** it SHALL extract: `owner`, `repo`, `ref` (branch/tag/commit), `filePath`, and `language` (from file extension or GitHub's language indicator)

#### Scenario: Diff View Metadata
- **GIVEN** the user is on a PR files or compare view
- **WHEN** the content script initializes
- **THEN** it SHALL extract per-file metadata for each diff panel: `filePath`, `language`, `side` (base or head), and corresponding `ref`
