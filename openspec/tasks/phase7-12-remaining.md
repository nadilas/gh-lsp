# Phases 7–12: Remaining Tasks — Task Details

## Phase 7: UI Renderer — Sidebar

### P7-T1: Sidebar Component (`src/ui/sidebar/Sidebar.tsx`)

**Dependencies**: P6-T1 (Shadow DOM Mount), P6-T4 (Display Subcomponents), P6-T5 (Theme)

**Purpose**: Dockable panel that displays persistent hover information.

**Implementation guide**:
- Preact component with position prop (right/left/top/bottom)
- Reuses display subcomponents from P6-T4
- Collapse/expand with CSS transitions
- Header with collapse button + current symbol name
- Content area scrollable
- Empty state: "Hover over a symbol to see type info"

**Acceptance criteria**:
- Renders at all four dock positions
- Collapse/expand toggle works
- Content updates smoothly when new hover data arrives
- Empty state displayed when no data

---

### P7-T2: Resize Handler (`src/ui/sidebar/resize.ts`)

**Dependencies**: P7-T1

**Purpose**: Drag-to-resize the sidebar panel.

**Implementation guide**:
- Drag handle element at the sidebar edge (border between sidebar and code)
- mousedown → track mousemove → update sidebar size → mouseup
- Clamp size: min 200px, max 50% of viewport dimension (width for left/right, height for top/bottom)
- Persist size preference in settings

**Acceptance criteria**:
- Drag resizes within bounds
- Size persisted and restored
- Works for all four positions

---

### P7-T3: Sidebar Integration

**Dependencies**: P7-T1, P7-T2, P5-T5

**Purpose**: Wire sidebar into content script lifecycle.

**Implementation guide**:
- Content script checks `displayMode` setting
- If `sidebar`: create sidebar panel, update on each hover
- If `popover`: create popover (existing P6 behavior)
- Setting change: tear down current, create new
- Sidebar receives hover data via same messaging path as popover

---

## Phase 8: Extension Pages

### P8-T1: Popup Page (`src/pages/popup/main.tsx`)

**Dependencies**: P1-T4 (Settings), P6-T5 (Theme)

**Implementation guide**:
- Compact Preact app (280px wide popup)
- Queries active tab to determine if on GitHub code page
- Reads extension status from background
- Toggle switch for enabled/disabled
- Display: current language, worker status, display mode
- Link to options page: `chrome.runtime.openOptionsPage()`

---

### P8-T2: Options Page (`src/pages/options/main.tsx`)

**Dependencies**: P1-T4 (Settings), P6-T5 (Theme)

**Implementation guide**:
- Full-page Preact app
- Sections: Display, Languages, Authentication, Performance, About
- Display: radio for popover/sidebar, sidebar position dropdown
- Languages: checkbox for each SupportedLanguage
- Authentication: PAT input with show/hide, validate button, masked display
- Performance: sliders/inputs for debounce, cache TTL, idle timeout, max workers
- Auto-save on change via settings helpers

---

### P8-T3: Settings Wiring

**Dependencies**: P8-T1, P8-T2, P1-T4

**Implementation guide**:
- All setting changes call `saveSettings()` immediately
- `chrome.storage.onChanged` listener in popup/options to keep UI in sync
- Background listener propagates changes to content scripts via `settings/changed` message

---

### P8-T4: Keyboard Shortcut Handlers

**Dependencies**: P2-T1 (Background Entry)

**Implementation guide**:
- `chrome.commands.onCommand.addListener` in background
- `toggle-extension` → toggle `settings.enabled`, notify all tabs
- `toggle-sidebar` → send message to active tab to toggle sidebar
- `pin-popover` → send message to active tab to pin current popover

---

## Phase 9: Cross-Browser Support

### P9-T1: WebExtension Polyfill Integration

**Dependencies**: All Chrome features complete (P8-T3)

**Implementation guide**:
- Replace all `chrome.*` calls with `import browser from 'webextension-polyfill'`
- Polyfill automatically handles Promise-based vs callback APIs
- Update imports in: background, content, popup, options

---

### P9-T2: Safari Build Step

**Dependencies**: P9-T1

**Implementation guide**:
- Add `build:safari` script to package.json
- Run `safari-web-extension-converter` on `dist/chrome/` output
- Adjust any Safari-incompatible CSP or API calls
- Output to `dist/safari/`

---

### P9-T3: Safari Verification

**Dependencies**: P9-T2

- Manual testing in Safari: extension loads, WASM works, hover displays correctly
- Document any Safari-specific workarounds needed

---

## Phase 10: Accessibility & Polish

### P10-T1: Accessibility

**Dependencies**: P7-T3 (All UI complete)

**Implementation guide**:
- Popover: `role="tooltip"`, `aria-live="polite"`
- Sidebar: `role="complementary"`, `aria-label="Code intelligence"`
- All buttons: `aria-label` describing action
- Focus trap in pinned popover
- Tab order through interactive elements
- `prefers-reduced-motion`: use `animation-duration: 0.01ms` override

---

### P10-T2: Internationalization

**Dependencies**: P10-T1

**Implementation guide**:
- Create `src/_locales/en/messages.json` with all user-facing strings
- Replace hardcoded strings with `chrome.i18n.getMessage('key')`
- Add `default_locale: "en"` to manifest

---

## Phase 11: End-to-End Testing

### P11-T1: E2E Test Setup

**Dependencies**: P9-T1

**Implementation guide**:
- Install Playwright: `pnpm add -D @playwright/test`
- Configure for Chrome extension loading:
  ```typescript
  // playwright.config.ts
  const pathToExtension = path.resolve('dist/chrome');
  use: {
    browserName: 'chromium',
    launchOptions: {
      args: [`--disable-extensions-except=${pathToExtension}`, `--load-extension=${pathToExtension}`]
    }
  }
  ```
- Create fixture helpers: navigate to GitHub, wait for extension, mock GitHub API

---

### P11-T2: E2E Test Suite

**Dependencies**: P11-T1

**Test cases**:
1. **Hover popover**: Navigate to repo → hover over typed symbol → verify popover shows type
2. **Sidebar mode**: Enable sidebar → hover → verify sidebar updates
3. **Extension toggle**: Disable via popup → verify hover no longer shows info
4. **Turbo navigation**: Navigate between files → verify extension reinitializes
5. **Scroll virtualization**: Scroll past visible lines → hover on newly rendered line → verify hover works
6. **PAT auth**: Configure PAT in options → verify API requests include auth header

---

## Phase 12: CI/CD & Release

### P12-T1: CI Pipeline (`.github/workflows/ci.yml`)

**Dependencies**: P11-T2

```yaml
name: CI
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build
```

---

### P12-T2: Release Pipeline (`.github/workflows/release.yml`)

**Dependencies**: P12-T1

```yaml
name: Release
on:
  push:
    tags: ['v*.*.*']
jobs:
  release:
    runs-on: macos-latest  # needed for Safari build
    steps:
      - Build Chrome zip
      - Build Safari Xcode project
      - Create GitHub Release with artifacts
```
