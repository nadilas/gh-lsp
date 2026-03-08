# UI Renderer — Specification

## Overview

The UI renderer is a Preact-based component system responsible for displaying LSP results to the user. It supports two display modes: a floating popover anchored to the hovered token, and a dockable sidebar panel. All UI is rendered within a Shadow DOM to isolate styles from GitHub's page CSS.

---

## Requirement: Display Mode — Popover

The extension SHALL support a floating popover that appears near the hovered token.

#### Scenario: Show Hover Popover
- **GIVEN** the content script receives a successful hover response from the background
- **WHEN** the response contains `MarkupContent`
- **THEN** the UI renderer SHALL display a popover containing:
  - The type/function signature rendered as syntax-highlighted code
  - Parameter information (names, types, defaults) in a structured format
  - Return type information
  - Documentation text (rendered from markdown)
  - A "Go to Definition" link (if definition location is available)
  - The source file path and line number of the declaration

#### Scenario: Popover Positioning
- **GIVEN** a popover needs to be displayed
- **WHEN** the UI renderer calculates the position
- **THEN** the popover SHALL:
  1. Be anchored below the hovered token by default
  2. Flip above the token if there is insufficient space below
  3. Shift horizontally to remain within the viewport
  4. Never overlap the hovered token itself
  5. Account for GitHub's sticky header and any visible toolbars

#### Scenario: Popover Dismissal
- **GIVEN** a popover is currently displayed
- **WHEN** any of the following occurs:
  - The user moves the mouse away from both the token AND the popover
  - The user presses the `Escape` key
  - The user scrolls more than 50px from the triggering position
  - The page navigates away
- **THEN** the popover SHALL be dismissed with a brief fade-out animation (150ms)

#### Scenario: Popover Persistence on Hover
- **GIVEN** a popover is displayed
- **WHEN** the user moves the mouse from the token INTO the popover
- **THEN** the popover SHALL remain visible, allowing the user to:
  - Select and copy text from the popover
  - Click links within the popover (e.g., "Go to Definition")
  - Scroll within the popover if content overflows

#### Scenario: Popover Content Overflow
- **GIVEN** the hover response contains content taller than the maximum popover height (configurable, default: 400px)
- **WHEN** the popover is rendered
- **THEN** the popover SHALL be scrollable and show a subtle scroll indicator

---

## Requirement: Display Mode — Sidebar Panel

The extension SHALL support a dockable sidebar panel for persistent code intelligence.

#### Scenario: Sidebar Activation
- **GIVEN** the user has configured the extension to use sidebar mode
- **WHEN** the user is on a supported code view page
- **THEN** the UI renderer SHALL inject a collapsible sidebar panel at the user's configured position (right, left, top, or bottom)

#### Scenario: Sidebar Position Options
- **GIVEN** the user opens extension settings
- **WHEN** they configure the sidebar position
- **THEN** the following options SHALL be available:
  - **Right** (default): Panel docked to the right side of the code view
  - **Left**: Panel docked to the left side of the code view
  - **Bottom**: Panel docked below the code view
  - **Top**: Panel docked above the code view

#### Scenario: Sidebar Content Update
- **GIVEN** the sidebar panel is visible
- **WHEN** the user hovers over or selects a code token
- **THEN** the sidebar SHALL update its content to show the hover information for the current token, replacing the previous content with a smooth transition

#### Scenario: Sidebar Collapse/Expand
- **GIVEN** the sidebar panel is visible
- **WHEN** the user clicks the collapse toggle or presses the configured keyboard shortcut
- **THEN** the sidebar SHALL collapse to a minimal tab/handle, and the code view SHALL reclaim the space

#### Scenario: Sidebar Resize
- **GIVEN** the sidebar panel is expanded
- **WHEN** the user drags the resize handle at the edge of the sidebar
- **THEN** the sidebar SHALL resize within min/max bounds (min: 200px, max: 50% of viewport)

---

## Requirement: Content Rendering

The UI renderer SHALL format and display LSP response data in a readable, IDE-like format.

#### Scenario: Type Signature Display
- **GIVEN** the hover response contains a type or function signature
- **WHEN** the content is rendered
- **THEN** the signature SHALL be displayed with:
  - Syntax highlighting matching the file's language
  - Monospace font consistent with GitHub's code font
  - Clear visual separation from documentation text

#### Scenario: Markdown Documentation Rendering
- **GIVEN** the hover response contains markdown documentation (JSDoc, GoDoc, docstrings)
- **WHEN** the content is rendered
- **THEN** the markdown SHALL be rendered as formatted HTML with:
  - Code blocks with syntax highlighting
  - Links rendered as clickable anchors
  - Lists, emphasis, and other standard markdown features

#### Scenario: Go-to-Definition Link
- **GIVEN** the definition location is available (from a parallel `textDocument/definition` response)
- **WHEN** the content is rendered
- **THEN** a "Go to Definition" link SHALL be displayed that:
  - For same-repo definitions: navigates to the GitHub blob view at the correct line
  - For external/unresolvable definitions: shows the file path and line number as text

#### Scenario: Parameter Information Display
- **GIVEN** the hover response includes function parameter information
- **WHEN** the content is rendered
- **THEN** each parameter SHALL be displayed showing:
  - Parameter name
  - Parameter type
  - Default value (if any)
  - Parameter documentation (if available)

#### Scenario: Declaration Source Display
- **GIVEN** the hover response includes definition location metadata
- **WHEN** the content is rendered
- **THEN** the source declaration location SHALL be shown as: `Defined in <file-path>:<line-number>`

---

## Requirement: Shadow DOM Isolation

The UI renderer SHALL use Shadow DOM to prevent style conflicts with GitHub's page.

#### Scenario: Style Isolation
- **GIVEN** the UI renderer injects elements into the GitHub page
- **WHEN** the elements are created
- **THEN** all extension UI SHALL be contained within a Shadow DOM root, ensuring:
  - Extension styles do not leak into GitHub's page
  - GitHub's styles do not affect extension UI
  - Extension CSS uses a self-contained design system

#### Scenario: Theme Support
- **GIVEN** the user may use GitHub in light or dark mode
- **WHEN** the extension UI is rendered
- **THEN** the UI SHALL detect GitHub's current theme (`data-color-mode` attribute) and apply matching light/dark styles

---

## Requirement: Loading and Error States

The UI renderer SHALL handle loading and error states gracefully.

#### Scenario: Loading State
- **GIVEN** a hover request has been sent but no response has been received yet
- **WHEN** more than 200ms has elapsed
- **THEN** the UI SHALL show a subtle loading indicator (pulsing skeleton or spinner) at the popover/sidebar location

#### Scenario: Unsupported Language
- **GIVEN** the background responds with an `unsupported_language` error
- **WHEN** the UI processes the error
- **THEN** the UI SHALL show a brief, dismissible message: "Language intelligence not available for {language}"

#### Scenario: LSP Server Error
- **GIVEN** the background responds with an `lsp_server_error`
- **WHEN** the UI processes the error
- **THEN** the UI SHALL show a brief error state and allow the user to retry

#### Scenario: No Information Available
- **GIVEN** the LSP server returns `null` (no hover information at this position)
- **WHEN** the response is received
- **THEN** the UI SHALL NOT display any popover or sidebar update (silent no-op)

---

## Requirement: Accessibility

The extension UI SHALL be accessible.

#### Scenario: Keyboard Navigation
- **GIVEN** the popover or sidebar is visible
- **WHEN** the user navigates with keyboard
- **THEN** all interactive elements (links, buttons, close) SHALL be focusable and operable via keyboard

#### Scenario: Screen Reader Support
- **GIVEN** a screen reader is active
- **WHEN** the popover or sidebar displays content
- **THEN** the UI SHALL use appropriate ARIA attributes (`role`, `aria-label`, `aria-live`) to announce content changes

#### Scenario: Reduced Motion
- **GIVEN** the user has `prefers-reduced-motion: reduce` set
- **WHEN** animations would normally play (fade-in, transitions)
- **THEN** the UI SHALL skip or minimize animations
