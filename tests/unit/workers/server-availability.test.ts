import { describe, it, expect } from 'vitest';
import {
  isServerAvailable,
  getWorkerUrl,
  getUnavailableReason,
} from '../../../src/workers/server-availability';
import type { SupportedLanguage } from '../../../src/shared/types';

describe('isServerAvailable', () => {
  it('returns true for typescript', () => {
    expect(isServerAvailable('typescript')).toBe(true);
  });

  it('returns true for javascript', () => {
    expect(isServerAvailable('javascript')).toBe(true);
  });

  it('returns false for go', () => {
    expect(isServerAvailable('go')).toBe(false);
  });

  it('returns true for rust', () => {
    expect(isServerAvailable('rust')).toBe(true);
  });

  it('returns false for python', () => {
    expect(isServerAvailable('python')).toBe(false);
  });
});

describe('getWorkerUrl', () => {
  it('returns ts-worker.js for typescript', () => {
    expect(getWorkerUrl('typescript')).toBe('workers/ts-worker.js');
  });

  it('returns ts-worker.js for javascript', () => {
    expect(getWorkerUrl('javascript')).toBe('workers/ts-worker.js');
  });

  it('returns null for go', () => {
    expect(getWorkerUrl('go')).toBeNull();
  });

  it('returns rust-worker.js for rust', () => {
    expect(getWorkerUrl('rust')).toBe('workers/rust-worker.js');
  });

  it('returns null for python', () => {
    expect(getWorkerUrl('python')).toBeNull();
  });
});

describe('getUnavailableReason', () => {
  it('returns reason for go', () => {
    expect(getUnavailableReason('go')).toContain('gopls');
  });

  it('returns reason for rust', () => {
    expect(getUnavailableReason('rust')).toContain('rust-analyzer');
  });

  it('returns reason for python', () => {
    expect(getUnavailableReason('python')).toContain('Pyright');
  });

  it('returns generic reason for unavailable languages', () => {
    const allLanguages: SupportedLanguage[] = [
      'go',
      'python',
    ];
    for (const lang of allLanguages) {
      const reason = getUnavailableReason(lang);
      expect(reason.length).toBeGreaterThan(0);
    }
  });
});
