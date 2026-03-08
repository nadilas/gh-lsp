import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { detectTheme, onThemeChange } from '../../../src/ui/theme';

/**
 * Creates a mock matchMedia implementation for jsdom (which doesn't provide one).
 */
function createMockMatchMedia(matches = false) {
  return vi.fn().mockImplementation((query: string) => ({
    matches: query === '(prefers-color-scheme: dark)' ? matches : false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

// Save original so we can restore after each test
const originalMatchMedia = window.matchMedia;

describe('detectTheme', () => {
  beforeEach(() => {
    // Default: system prefers light
    window.matchMedia = createMockMatchMedia(false);
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-color-mode');
    document.documentElement.removeAttribute('data-dark-theme');
    document.documentElement.removeAttribute('data-light-theme');
    window.matchMedia = originalMatchMedia;
  });

  it('returns "dark" when data-color-mode is "dark"', () => {
    document.documentElement.setAttribute('data-color-mode', 'dark');
    expect(detectTheme()).toBe('dark');
  });

  it('returns "light" when data-color-mode is "light"', () => {
    document.documentElement.setAttribute('data-color-mode', 'light');
    expect(detectTheme()).toBe('light');
  });

  it('returns system preference when data-color-mode is "auto"', () => {
    document.documentElement.setAttribute('data-color-mode', 'auto');

    // jsdom defaults to no match for prefers-color-scheme: dark,
    // so detectTheme() should return 'light' by default
    expect(detectTheme()).toBe('light');
  });

  it('returns system dark theme when auto mode and system prefers dark', () => {
    document.documentElement.setAttribute('data-color-mode', 'auto');
    window.matchMedia = createMockMatchMedia(true);
    expect(detectTheme()).toBe('dark');
  });

  it('returns "light" when data-color-mode is absent', () => {
    // No data-color-mode attribute set
    expect(detectTheme()).toBe('light');
  });

  it('returns system preference for unrecognized data-color-mode values', () => {
    document.documentElement.setAttribute('data-color-mode', 'unknown-value');
    // Falls through to system preference, which is light by default in jsdom
    expect(detectTheme()).toBe('light');
  });
});

describe('onThemeChange', () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    window.matchMedia = createMockMatchMedia(false);
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    document.documentElement.removeAttribute('data-color-mode');
    document.documentElement.removeAttribute('data-dark-theme');
    document.documentElement.removeAttribute('data-light-theme');
    window.matchMedia = originalMatchMedia;
  });

  it('calls callback when data-color-mode changes from light to dark', async () => {
    document.documentElement.setAttribute('data-color-mode', 'light');
    const callback = vi.fn();
    cleanup = onThemeChange(callback);

    // Change to dark mode
    document.documentElement.setAttribute('data-color-mode', 'dark');

    // MutationObserver is async, wait for it to fire
    await flushMutationObserver();

    expect(callback).toHaveBeenCalledWith('dark');
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('calls callback when data-color-mode changes from dark to light', async () => {
    document.documentElement.setAttribute('data-color-mode', 'dark');
    const callback = vi.fn();
    cleanup = onThemeChange(callback);

    document.documentElement.setAttribute('data-color-mode', 'light');

    await flushMutationObserver();

    expect(callback).toHaveBeenCalledWith('light');
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('does not call callback when theme remains the same', async () => {
    document.documentElement.setAttribute('data-color-mode', 'light');
    const callback = vi.fn();
    cleanup = onThemeChange(callback);

    // Set to the same value
    document.documentElement.setAttribute('data-color-mode', 'light');

    await flushMutationObserver();

    expect(callback).not.toHaveBeenCalled();
  });

  it('calls callback on multiple theme changes', async () => {
    document.documentElement.setAttribute('data-color-mode', 'light');
    const callback = vi.fn();
    cleanup = onThemeChange(callback);

    document.documentElement.setAttribute('data-color-mode', 'dark');
    await flushMutationObserver();

    document.documentElement.setAttribute('data-color-mode', 'light');
    await flushMutationObserver();

    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenNthCalledWith(1, 'dark');
    expect(callback).toHaveBeenNthCalledWith(2, 'light');
  });

  it('stops listening after cleanup is called', async () => {
    document.documentElement.setAttribute('data-color-mode', 'light');
    const callback = vi.fn();
    cleanup = onThemeChange(callback);

    // Clean up
    cleanup();
    cleanup = undefined;

    // Change theme after cleanup
    document.documentElement.setAttribute('data-color-mode', 'dark');
    await flushMutationObserver();

    expect(callback).not.toHaveBeenCalled();
  });

  it('responds to data-color-mode attribute removal', async () => {
    document.documentElement.setAttribute('data-color-mode', 'dark');
    const callback = vi.fn();
    cleanup = onThemeChange(callback);

    // Remove the attribute — should fall back to system preference (light)
    document.documentElement.removeAttribute('data-color-mode');
    await flushMutationObserver();

    expect(callback).toHaveBeenCalledWith('light');
  });

  it('responds to system preference change when in auto mode', () => {
    document.documentElement.setAttribute('data-color-mode', 'auto');

    // Track the event listener so we can manually trigger it
    let changeHandler: ((e: MediaQueryListEvent) => void) | null = null;
    const mockMediaQuery = {
      matches: false,
      media: '(prefers-color-scheme: dark)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn((event: string, handler: (e: MediaQueryListEvent) => void) => {
        if (event === 'change') {
          changeHandler = handler;
        }
      }),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };

    window.matchMedia = vi.fn().mockReturnValue(mockMediaQuery);

    const callback = vi.fn();
    cleanup = onThemeChange(callback);

    // Simulate system theme change to dark
    mockMediaQuery.matches = true;
    (changeHandler as unknown as (e: MediaQueryListEvent) => void)({ matches: true } as MediaQueryListEvent);

    expect(callback).toHaveBeenCalledWith('dark');
  });

  it('returns a cleanup function that is safe to call multiple times', () => {
    const callback = vi.fn();
    cleanup = onThemeChange(callback);

    cleanup();
    expect(() => cleanup!()).not.toThrow();
    cleanup = undefined;
  });
});

/**
 * Flush pending MutationObserver callbacks.
 * MutationObserver in jsdom may deliver mutations asynchronously.
 */
function flushMutationObserver(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
