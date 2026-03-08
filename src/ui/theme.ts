import type { DetectedTheme } from '../shared/types';

/**
 * Detects the current GitHub theme by reading the `data-color-mode` attribute
 * on the <html> element. GitHub sets this to 'light', 'dark', or 'auto'.
 * When set to 'auto', we check the system's prefers-color-scheme media query.
 *
 * @returns The detected theme: 'light' or 'dark'
 */
export function detectTheme(): DetectedTheme {
  const colorMode = document.documentElement.getAttribute('data-color-mode');

  if (colorMode === 'dark') {
    return 'dark';
  }

  if (colorMode === 'light') {
    return 'light';
  }

  // 'auto' or unrecognized/missing: check data-dark-theme / data-light-theme
  // attributes that GitHub uses, then fall back to system preference
  if (colorMode === 'auto') {
    return getSystemTheme();
  }

  // No data-color-mode attribute: check if GitHub uses a legacy theme class
  // or fall back to system preference
  return getSystemTheme();
}

/**
 * Returns the system theme preference using the prefers-color-scheme media query.
 */
function getSystemTheme(): DetectedTheme {
  if (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches
  ) {
    return 'dark';
  }
  return 'light';
}

/**
 * Registers a callback that fires whenever the effective theme changes.
 * Monitors two sources:
 *   1. Changes to the `data-color-mode` attribute on <html> (GitHub theme toggle)
 *   2. Changes to the system `prefers-color-scheme` media query (OS-level switch)
 *
 * The callback receives the new DetectedTheme value. It only fires when the
 * effective theme actually changes (light→dark or dark→light), not on every
 * attribute mutation.
 *
 * @param callback - Function called with the new theme when it changes
 * @returns A cleanup function that removes all listeners
 */
export function onThemeChange(
  callback: (theme: DetectedTheme) => void
): () => void {
  let lastTheme = detectTheme();

  const notifyIfChanged = (): void => {
    const currentTheme = detectTheme();
    if (currentTheme !== lastTheme) {
      lastTheme = currentTheme;
      callback(currentTheme);
    }
  };

  // Watch for data-color-mode attribute changes on <html>
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (
        mutation.type === 'attributes' &&
        (mutation.attributeName === 'data-color-mode' ||
          mutation.attributeName === 'data-dark-theme' ||
          mutation.attributeName === 'data-light-theme')
      ) {
        notifyIfChanged();
        break;
      }
    }
  });

  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-color-mode', 'data-dark-theme', 'data-light-theme'],
  });

  // Watch for system color scheme changes (relevant when data-color-mode is 'auto')
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const mediaHandler = (): void => {
    notifyIfChanged();
  };

  // Use addEventListener (modern) with fallback to addListener (legacy)
  if (mediaQuery.addEventListener) {
    mediaQuery.addEventListener('change', mediaHandler);
  } else if (mediaQuery.addListener) {
    mediaQuery.addListener(mediaHandler);
  }

  // Return cleanup function
  return () => {
    observer.disconnect();

    if (mediaQuery.removeEventListener) {
      mediaQuery.removeEventListener('change', mediaHandler);
    } else if (mediaQuery.removeListener) {
      mediaQuery.removeListener(mediaHandler);
    }
  };
}
