# Safari Verification Checklist

This document describes the verification steps for the Safari build of the gh-lsp browser extension, along with known Safari-specific considerations and workarounds.

## Build Verification

- [ ] `pnpm build` produces `dist/chrome/` with a valid `manifest.json`
- [ ] `pnpm build:safari` runs `scripts/build-safari.sh` successfully on macOS
- [ ] `safari-web-extension-converter` produces an `.xcodeproj` in `dist/safari/`
- [ ] Xcode project builds without errors: `xcodebuild -project dist/safari/gh-lsp/gh-lsp.xcodeproj -scheme 'gh-lsp (macOS)' build`

## Extension Loading

- [ ] Extension appears in Safari > Settings > Extensions
- [ ] Extension can be enabled/disabled via Safari preferences
- [ ] Extension icon appears in the Safari toolbar
- [ ] Clicking the toolbar icon opens the popup page

## Core Functionality

- [ ] **Page detection**: Navigate to a GitHub blob view (e.g., `github.com/owner/repo/blob/main/src/index.ts`) — extension activates
- [ ] **Non-code page**: Navigate to GitHub Issues — extension stays dormant (no errors in console)
- [ ] **Turbo navigation**: Click between files on GitHub — extension re-initializes correctly without full page reload
- [ ] **Hover popover**: Hover over a typed symbol — popover appears with type information after debounce
- [ ] **Popover dismiss**: Move mouse away — popover fades out; press Escape — popover dismisses immediately
- [ ] **Popover pin**: Pin the popover — it stays visible; click close — it dismisses
- [ ] **Go-to-definition**: Click the definition link in the popover — navigates to the correct file/line on GitHub
- [ ] **Sidebar mode**: Switch to sidebar in settings — sidebar panel appears; hover shows info in sidebar
- [ ] **Sidebar collapse/expand**: Click toggle button — sidebar collapses/expands
- [ ] **Sidebar resize**: Drag the resize handle — sidebar changes size within min/max bounds

## Settings Persistence

- [ ] **Popup page**: Toggle enabled/disabled — state persists across popup open/close
- [ ] **Options page**: All sections render correctly (Display, Languages, Authentication, Performance, Theme, About)
- [ ] **Display mode**: Change popover/sidebar — change persists and takes effect immediately
- [ ] **Language toggles**: Enable/disable specific languages — changes persist
- [ ] **PAT input**: Enter and save a GitHub PAT — stored securely, masked display works
- [ ] **PAT validation**: Click Validate — `GET /user` API call succeeds with valid PAT
- [ ] **Performance sliders**: Adjust debounce, cache TTL, worker idle timeout, max workers — values persist
- [ ] **Theme**: Change auto/light/dark — theme applies correctly to popup and options pages

## WASM / Language Servers

- [ ] **TypeScript server**: Hover over a `.ts` file symbol — type info displays correctly
- [ ] **JavaScript server**: Hover over a `.js` file symbol — type info displays
- [ ] **Worker lifecycle**: Workers spawn on first request, reuse on subsequent, idle timeout terminates

## Theme Integration

- [ ] **Light mode**: GitHub light theme → extension uses light theme variables
- [ ] **Dark mode**: GitHub dark theme → extension uses dark theme variables
- [ ] **Auto mode**: System preference change → extension theme updates

## Keyboard Shortcuts

- [ ] **Alt+Shift+L**: Toggle extension on/off
- [ ] **Alt+Shift+S**: Toggle sidebar collapsed/expanded
- [ ] **Alt+Shift+P**: Pin/unpin current popover

Note: Safari may remap some keyboard shortcuts. Check Safari > Settings > Extensions > gh-lsp for the actual key bindings.

## Accessibility

- [ ] Popover has `role="tooltip"` and `aria-live="polite"`
- [ ] Sidebar has `role="complementary"` and `aria-label`
- [ ] All buttons have descriptive `aria-label` attributes
- [ ] VoiceOver can navigate popover and sidebar content
- [ ] `prefers-reduced-motion` disables animations

## Performance

- [ ] Extension does not cause noticeable lag on GitHub code pages
- [ ] Memory usage stays reasonable after prolonged use (workers idle-terminate)
- [ ] No console errors during normal usage

---

## Safari-Specific Considerations

### Known Differences from Chrome

1. **Manifest V3 support**: Safari supports Manifest V3 starting with Safari 16.4+. The `safari-web-extension-converter` handles most manifest translation automatically.

2. **`wasm-unsafe-eval` CSP**: Safari may handle the `wasm-unsafe-eval` content security policy directive differently than Chrome. If WASM loading fails, check the extension's CSP in the converted manifest and ensure `wasm-unsafe-eval` is preserved.

3. **Service worker lifecycle**: Safari's implementation of background service workers may have different cold-start timing. The extension uses lazy initialization (`ensureInitialized()`) to handle service worker restarts gracefully.

4. **`chrome.commands` key bindings**: Safari may not support all Chrome key binding modifiers. The `suggested_key` values in the manifest are suggestions; Safari may use different defaults or allow user customization through its own preferences.

5. **`webextension-polyfill`**: The extension uses `webextension-polyfill` which provides a unified Promise-based API. This handles differences between Chrome's callback-based APIs and Safari's native Promise support.

6. **Web Worker creation**: Safari requires Web Workers to be created from extension-bundled scripts. The Vite build bundles worker entry points as separate chunks, which `safari-web-extension-converter` should place in the extension's `Resources` directory.

7. **`crypto.randomUUID()`**: Available in Safari 15.4+. The extension uses this for request ID generation. No polyfill needed for Safari 16.4+ (minimum required for MV3).

8. **Storage quotas**: `browser.storage.sync` has a 100KB quota in Chrome. Safari may have different limits. The extension stores minimal data (settings object < 1KB, PAT in `storage.local`).

### Workarounds Applied

- **Structural DOM selectors**: The content script uses structural selectors (parent-child relationships, `data-*` attributes) rather than GitHub's minified class names, which works consistently across browsers.
- **Feature detection**: The extension checks for API availability before using optional features rather than assuming Chrome-specific behavior.
- **Promise-based APIs**: All extension API calls go through `webextension-polyfill`, avoiding callback/Promise API differences between browsers.
