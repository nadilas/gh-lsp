import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { t } from '../../../src/shared/i18n';

// Set up chrome.i18n mock for the proxy-based browser polyfill mock
const mockGetMessage = vi.fn<(key: string, substitutions?: string | string[]) => string>();

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).chrome = {
    i18n: {
      getMessage: mockGetMessage,
    },
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).chrome;
});

describe('i18n helper', () => {
  it('returns browser.i18n.getMessage result when available', () => {
    mockGetMessage.mockReturnValue('Localized text');

    expect(t('extensionName', 'Fallback')).toBe('Localized text');
    expect(mockGetMessage).toHaveBeenCalledWith('extensionName', undefined);
  });

  it('returns fallback when getMessage returns empty string', () => {
    mockGetMessage.mockReturnValue('');

    expect(t('unknownKey', 'My fallback')).toBe('My fallback');
  });

  it('returns fallback when getMessage throws', () => {
    mockGetMessage.mockImplementation(() => {
      throw new Error('Extension context invalidated');
    });

    expect(t('extensionName', 'Fallback text')).toBe('Fallback text');
  });

  it('returns fallback when i18n is not available', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).chrome = {};

    expect(t('extensionName', 'Fallback text')).toBe('Fallback text');
  });

  it('passes substitutions to getMessage', () => {
    mockGetMessage.mockReturnValue('Cache TTL (30 min)');

    expect(t('labelCacheTtl', 'Cache TTL (30 min)', '30')).toBe('Cache TTL (30 min)');
    expect(mockGetMessage).toHaveBeenCalledWith('labelCacheTtl', '30');
  });

  it('passes array substitutions to getMessage', () => {
    mockGetMessage.mockReturnValue('Authenticated as octocat');

    expect(t('msgAuthenticatedAs', 'Authenticated as octocat', ['octocat'])).toBe(
      'Authenticated as octocat',
    );
    expect(mockGetMessage).toHaveBeenCalledWith('msgAuthenticatedAs', ['octocat']);
  });
});
