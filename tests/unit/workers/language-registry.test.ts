import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getCapabilities,
  registerServerFactory,
  loadWasmServer,
  hasServerFactory,
} from '../../../src/workers/language-registry';
import type { WasmServer } from '../../../src/workers/language-registry';
import { VirtualFileSystem } from '../../../src/workers/vfs';
import type { SupportedLanguage } from '../../../src/shared/types';

function createMockServer(): WasmServer {
  return {
    initialize: vi.fn(async () => ({ capabilities: {} })),
    handleRequest: vi.fn(async () => null),
    handleNotification: vi.fn(),
    shutdown: vi.fn(async () => undefined),
  };
}

describe('getCapabilities', () => {
  it('returns hover + definition + signatureHelp for TypeScript', () => {
    const caps = getCapabilities('typescript');
    expect(caps.hoverProvider).toBe(true);
    expect(caps.definitionProvider).toBe(true);
    expect(caps.signatureHelpProvider).toBe(true);
  });

  it('returns hover + definition + signatureHelp for JavaScript', () => {
    const caps = getCapabilities('javascript');
    expect(caps.hoverProvider).toBe(true);
    expect(caps.definitionProvider).toBe(true);
    expect(caps.signatureHelpProvider).toBe(true);
  });

  it('returns hover + definition for Go (no signatureHelp)', () => {
    const caps = getCapabilities('go');
    expect(caps.hoverProvider).toBe(true);
    expect(caps.definitionProvider).toBe(true);
    expect(caps.signatureHelpProvider).toBe(false);
  });

  it('returns hover + definition for Rust (no signatureHelp)', () => {
    const caps = getCapabilities('rust');
    expect(caps.hoverProvider).toBe(true);
    expect(caps.definitionProvider).toBe(true);
    expect(caps.signatureHelpProvider).toBe(false);
  });

  it('returns hover + definition + signatureHelp for Python', () => {
    const caps = getCapabilities('python');
    expect(caps.hoverProvider).toBe(true);
    expect(caps.definitionProvider).toBe(true);
    expect(caps.signatureHelpProvider).toBe(true);
  });

  it('returns hover + definition + signatureHelp for Elixir', () => {
    const caps = getCapabilities('elixir');
    expect(caps.hoverProvider).toBe(true);
    expect(caps.definitionProvider).toBe(true);
    expect(caps.signatureHelpProvider).toBe(true);
  });

  it('declares capabilities for all supported languages', () => {
    const languages: SupportedLanguage[] = [
      'typescript',
      'javascript',
      'go',
      'rust',
      'python',
      'elixir',
    ];
    for (const lang of languages) {
      const caps = getCapabilities(lang);
      expect(caps).toBeDefined();
      expect(typeof caps.hoverProvider).toBe('boolean');
      expect(typeof caps.definitionProvider).toBe('boolean');
    }
  });
});

describe('registerServerFactory / loadWasmServer', () => {
  beforeEach(() => {
    // Register a mock factory for testing
    registerServerFactory('typescript', async () => createMockServer());
  });

  it('loads a server using the registered factory', async () => {
    const vfs = new VirtualFileSystem();
    const server = await loadWasmServer('typescript', vfs);

    expect(server).toBeDefined();
    expect(typeof server.initialize).toBe('function');
    expect(typeof server.handleRequest).toBe('function');
    expect(typeof server.handleNotification).toBe('function');
    expect(typeof server.shutdown).toBe('function');
  });

  it('passes VFS to the factory', async () => {
    const vfs = new VirtualFileSystem();
    const factory = vi.fn(async () => createMockServer());
    registerServerFactory('go', factory);

    await loadWasmServer('go', vfs);

    expect(factory).toHaveBeenCalledWith(vfs);
  });

  it('throws for unregistered languages', async () => {
    const vfs = new VirtualFileSystem();

    await expect(loadWasmServer('rust', vfs)).rejects.toThrow(
      'No WASM server factory registered for language: rust',
    );
  });
});

describe('hasServerFactory', () => {
  beforeEach(() => {
    registerServerFactory('typescript', async () => createMockServer());
  });

  it('returns true for registered languages', () => {
    expect(hasServerFactory('typescript')).toBe(true);
  });

  it('returns false for unregistered languages', () => {
    expect(hasServerFactory('python')).toBe(false);
  });
});
