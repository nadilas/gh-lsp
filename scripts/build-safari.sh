#!/usr/bin/env bash
# build-safari.sh — Converts the Chrome extension build into a Safari Web Extension Xcode project.
#
# Prerequisites:
#   - macOS with Xcode installed (provides safari-web-extension-converter via xcrun)
#   - Chrome extension already built in dist/chrome/
#
# Usage:
#   pnpm build:safari        (builds Chrome first, then converts)
#   bash scripts/build-safari.sh   (assumes dist/chrome/ already exists)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CHROME_DIST="$PROJECT_ROOT/dist/chrome"
SAFARI_DIST="$PROJECT_ROOT/dist/safari"
APP_NAME="gh-lsp"
BUNDLE_ID="com.github.nadilas.gh-lsp"

# ─── Pre-flight checks ──────────────────────────────────────────────────────

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "ERROR: Safari Web Extension conversion requires macOS with Xcode."
  echo "       Current platform: $(uname -s)"
  echo ""
  echo "To build for Safari:"
  echo "  1. Run 'pnpm build' to produce dist/chrome/"
  echo "  2. Copy the project to a macOS machine"
  echo "  3. Run 'pnpm build:safari' there"
  echo ""
  echo "Or use the CI release pipeline which runs on macos-latest."
  exit 1
fi

if ! xcrun --find safari-web-extension-converter &>/dev/null; then
  echo "ERROR: safari-web-extension-converter not found."
  echo "       Install Xcode from the Mac App Store and run:"
  echo "         xcode-select --install"
  exit 1
fi

# ─── Build Chrome extension if not already built ────────────────────────────

if [[ ! -d "$CHROME_DIST" ]] || [[ ! -f "$CHROME_DIST/manifest.json" ]]; then
  echo "Chrome build not found at $CHROME_DIST — building now..."
  cd "$PROJECT_ROOT"
  pnpm build
fi

echo "Chrome extension found at: $CHROME_DIST"

# ─── Clean previous Safari output ──────────────────────────────────────────

if [[ -d "$SAFARI_DIST" ]]; then
  echo "Removing previous Safari build at: $SAFARI_DIST"
  rm -rf "$SAFARI_DIST"
fi

mkdir -p "$SAFARI_DIST"

# ─── Convert to Safari Web Extension ────────────────────────────────────────

echo "Converting Chrome extension to Safari Web Extension..."
echo "  Source:     $CHROME_DIST"
echo "  Output:     $SAFARI_DIST"
echo "  App name:   $APP_NAME"
echo "  Bundle ID:  $BUNDLE_ID"

xcrun safari-web-extension-converter \
  "$CHROME_DIST" \
  --project-location "$SAFARI_DIST" \
  --app-name "$APP_NAME" \
  --bundle-identifier "$BUNDLE_ID" \
  --swift \
  --macos-only \
  --no-prompt \
  --no-open

# ─── Verify output ─────────────────────────────────────────────────────────

XCODEPROJ=$(find "$SAFARI_DIST" -name "*.xcodeproj" -maxdepth 2 | head -n 1)

if [[ -n "$XCODEPROJ" ]]; then
  echo ""
  echo "Safari Web Extension project created successfully:"
  echo "  $XCODEPROJ"
  echo ""
  echo "To build the Safari extension:"
  echo "  open '$XCODEPROJ'"
  echo "  — or —"
  echo "  xcodebuild -project '$XCODEPROJ' -scheme '$APP_NAME (macOS)' build"
else
  echo "WARNING: No .xcodeproj found in $SAFARI_DIST."
  echo "         The conversion may have failed. Check the output above."
  exit 1
fi
