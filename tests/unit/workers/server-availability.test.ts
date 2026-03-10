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

  it('returns true for go', () => {
    expect(isServerAvailable('go')).toBe(true);
  });

  it('returns true for rust', () => {
    expect(isServerAvailable('rust')).toBe(true);
  });

  it('returns false for python', () => {
    expect(isServerAvailable('python')).toBe(false);
  });

  it('returns true for elixir', () => {
    expect(isServerAvailable('elixir')).toBe(true);
  });
});

describe('getWorkerUrl', () => {
  it('returns ts-worker.js for typescript', () => {
    expect(getWorkerUrl('typescript')).toBe('workers/ts-worker.js');
  });

  it('returns ts-worker.js for javascript', () => {
    expect(getWorkerUrl('javascript')).toBe('workers/ts-worker.js');
  });

  it('returns go-worker.js for go', () => {
    expect(getWorkerUrl('go')).toBe('workers/go-worker.js');
  });

  it('returns rust-worker.js for rust', () => {
    expect(getWorkerUrl('rust')).toBe('workers/rust-worker.js');
  });

  it('returns null for python', () => {
    expect(getWorkerUrl('python')).toBeNull();
  });

  it('returns elixir-worker.js for elixir', () => {
    expect(getWorkerUrl('elixir')).toBe('workers/elixir-worker.js');
  });
});

describe('getUnavailableReason', () => {
  it('returns reason for go (now available via tree-sitter)', () => {
    expect(getUnavailableReason('go')).toContain('tree-sitter');
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
      'typescript',
      'javascript',
      'elixir',
      'rust',
    ];

    const unavailableLanguages: SupportedLanguage[] = [
      'python',
    ];
    for (const lang of unavailableLanguages) {
      const reason = getUnavailableReason(lang);
      expect(reason.length).toBeGreaterThan(0);
    }
  });
});
