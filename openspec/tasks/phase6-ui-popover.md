# Phase 6: UI Renderer — Popover — Task Details

## Prerequisites
- P5-T5 (Content Script Entry Point) complete
- P4-T2 (at least one WASM server working)
- P6-T1 can start after P1-T1

## Tasks

### P6-T1: Shadow DOM Mount (`src/ui/mount.ts`)

**Purpose**: Create an isolated rendering context for extension UI within GitHub's page.

**Implementation guide**:

```typescript
import { render, ComponentChild } from 'preact';

export class ExtensionMount {
  private host: HTMLElement | null = null;
  private shadowRoot: ShadowRoot | null = null;

  create(): ShadowRoot;
  destroy(): void;
  render(component: ComponentChild): void;

  get root(): ShadowRoot | null;
}

function injectStyles(shadowRoot: ShadowRoot): void;
```

**Key behaviors**:
- Creates a `<div id="gh-lsp-root">` host element appended to `document.body`
- Attaches Shadow DOM with `mode: 'open'`
- Injects bundled CSS into shadow root via `<style>` element
- Preact renders into a container `<div>` inside the shadow root
- `destroy()` unmounts Preact, removes host element

**Tests required**: Shadow root created with correct mode; styles injected; destroy cleans up.

---

### P6-T2: Popover Positioning (`src/ui/popover/positioning.ts`)

**Purpose**: Compute pixel position for the popover tooltip relative to the hovered token.

**Implementation guide**:

```typescript
export interface PositionInput {
  tokenRect: DOMRect;           // getBoundingClientRect() of hovered token
  popoverWidth: number;
  popoverHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  scrollY: number;
  stickyHeaderHeight: number;   // GitHub's header height (~60px)
}

export function calculatePopoverPosition(input: PositionInput): PopoverPosition;
```

**Algorithm**:
1. Default placement: below token, left-aligned with token start
2. Check vertical space below: if `tokenRect.bottom + popoverHeight + gap > viewportHeight`, flip to above
3. Check vertical space above: if `tokenRect.top - popoverHeight - gap < stickyHeaderHeight`, keep below (clamp)
4. Horizontal: if `tokenRect.left + popoverWidth > viewportWidth`, shift left. If `left < 0`, clamp to 0.
5. Gap between token and popover: 4px
6. Return `{ top, left, placement: 'above' | 'below' }`

**Tests required**:
- Default placement below token
- Flips above when no space below
- Stays below when no space above either (near top of page)
- Shifts left when would overflow right
- Shifts right when would overflow left
- Accounts for sticky header
- Token at viewport edge

---

### P6-T3: Popover Component (`src/ui/popover/Popover.tsx`)

**Purpose**: Preact component that renders the floating type information tooltip.

**Implementation guide**:

```tsx
import { h, FunctionComponent } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';

interface PopoverProps {
  state: PopoverState;
  data: HoverDisplayData | null;
  position: PopoverPosition;
  onDismiss: () => void;
  onPin: () => void;
}

export const Popover: FunctionComponent<PopoverProps> = (props) => {
  // Render only when state is 'loading', 'visible', 'pinned', or 'error'
  // Position absolutely based on props.position
  // Handle mouse enter/leave for persistence
  // Handle Escape key for dismissal
  // Handle scroll for dismissal
};
```

**Key behaviors**:
- States: hidden (don't render), loading (show skeleton), visible (show data), pinned (show data, no auto-dismiss), error (show error)
- Mouse enter on popover: prevents dismissal
- Mouse leave from both token AND popover: starts dismiss timer (150ms fade)
- Escape key: immediate dismiss
- Scroll >50px from trigger position: dismiss
- Pin: transitions to 'pinned' state, shows close button
- Scrollable content area with max-height
- Reduced motion: skip fade animation

**Tests required**: Component rendering in each state; dismiss on Escape; pin toggle.

---

### P6-T4: Display Subcomponents

**Purpose**: Individual components for rendering different parts of the hover information.

**Components**:

```
src/ui/components/
  SignatureDisplay.tsx    — Syntax-highlighted code signature
  MarkdownRenderer.tsx   — Markdown → HTML renderer
  ParameterList.tsx      — Structured parameter display
  DefinitionLink.tsx     — "Go to Definition" clickable link
  LoadingState.tsx       — Pulsing skeleton loader
  ErrorState.tsx         — Error message with retry
```

**SignatureDisplay**: Renders `signature` string with monospace font, optionally with syntax highlighting (can use a lightweight highlighter or just `<pre><code>`).

**MarkdownRenderer**: Converts markdown string to safe HTML. Must sanitize to prevent XSS. Can use a lightweight library like `marked` + `DOMPurify`, or a simple regex-based renderer for the subset of markdown used in docs.

**ParameterList**: Table-like display of parameters: `name: type = default — documentation`.

**DefinitionLink**: Constructs GitHub blob URL: `https://github.com/{owner}/{repo}/blob/{ref}/{filePath}#L{line}`. Opens in new tab.

**LoadingState**: Skeleton UI with CSS animation. Shown after 200ms delay (not immediately, to avoid flicker for fast responses).

**ErrorState**: Shows error message. For `unsupported_language`: dismissible info. For `lsp_server_error`: shows retry button.

**Tests required**: DefinitionLink constructs correct URL; ErrorState shows retry for server errors; LoadingState respects 200ms delay.

---

### P6-T5: Theme Detection (`src/ui/styles/theme.css`, `src/ui/theme.ts`)

**Purpose**: Match extension UI theme to GitHub's current light/dark mode.

**Implementation guide**:

```typescript
// src/ui/theme.ts
export function detectTheme(): DetectedTheme {
  const mode = document.documentElement.getAttribute('data-color-mode');
  if (mode === 'dark') return 'dark';
  if (mode === 'light') return 'light';
  // 'auto' mode: check system preference
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function onThemeChange(callback: (theme: DetectedTheme) => void): () => void {
  // MutationObserver on <html> data-color-mode attribute
  // Also listen to prefers-color-scheme change
}
```

```css
/* src/ui/styles/theme.css */
:host {
  --ghlsp-bg: #ffffff;
  --ghlsp-text: #1f2328;
  --ghlsp-border: #d0d7de;
  --ghlsp-code-bg: #f6f8fa;
  /* ... more variables */
}

:host([data-theme="dark"]) {
  --ghlsp-bg: #0d1117;
  --ghlsp-text: #e6edf3;
  --ghlsp-border: #30363d;
  --ghlsp-code-bg: #161b22;
  /* ... more variables */
}
```

**Tests required**: Detect light/dark from `data-color-mode`; auto mode uses system preference.

---

## Parallelization Notes

- P6-T1 and P6-T5 can be built in parallel (both are foundational)
- P6-T2 depends on P6-T1
- P6-T3 depends on P6-T2
- P6-T4 can be built in parallel with P6-T2/P6-T3 (independent components)
