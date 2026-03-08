import browser from './browser';

/**
 * Returns the localized string for the given message key.
 *
 * Uses `browser.i18n.getMessage()` when available (inside the extension
 * runtime). Falls back to `fallback` otherwise — this allows the same
 * code to work in unit tests and Storybook without a full extension
 * environment.
 *
 * @param key     Message key defined in `_locales/<lang>/messages.json`
 * @param fallback  String to return when `i18n` is unavailable or returns ''
 * @param substitutions  Optional substitution strings for placeholders
 */
export function t(
  key: string,
  fallback: string,
  substitutions?: string | string[],
): string {
  try {
    const msg = browser.i18n?.getMessage(key, substitutions);
    return msg || fallback;
  } catch {
    return fallback;
  }
}
