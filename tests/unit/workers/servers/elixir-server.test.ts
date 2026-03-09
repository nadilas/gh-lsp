import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createElixirServer } from '../../../../src/workers/servers/elixir-server';
import { VirtualFileSystem } from '../../../../src/workers/vfs';
import type { WasmServer } from '../../../../src/workers/language-registry';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TEST_URI = 'gh-lsp://owner/repo/main/lib/my_app.ex';
const TEST_URI_2 = 'gh-lsp://owner/repo/main/lib/my_app/accounts.ex';

function makeHoverParams(uri: string, line: number, character: number) {
  return {
    textDocument: { uri },
    position: { line, character },
  };
}

function makeDefinitionParams(uri: string, line: number, character: number) {
  return {
    textDocument: { uri },
    position: { line, character },
  };
}

function makeSignatureHelpParams(uri: string, line: number, character: number) {
  return {
    textDocument: { uri },
    position: { line, character },
  };
}

// ─── Server Lifecycle Tests ──────────────────────────────────────────────────

describe('createElixirServer', () => {
  let vfs: VirtualFileSystem;
  let server: WasmServer;

  beforeEach(async () => {
    vfs = new VirtualFileSystem();
    server = await createElixirServer(vfs);
  });

  afterEach(async () => {
    await server.shutdown();
  });

  describe('lifecycle', () => {
    it('creates a server successfully', () => {
      expect(server).toBeDefined();
      expect(typeof server.initialize).toBe('function');
      expect(typeof server.handleRequest).toBe('function');
      expect(typeof server.handleNotification).toBe('function');
      expect(typeof server.shutdown).toBe('function');
    });

    it('initialize returns capabilities', async () => {
      const result = (await server.initialize({})) as {
        capabilities: {
          hoverProvider: boolean;
          definitionProvider: boolean;
          signatureHelpProvider: boolean;
        };
      };

      expect(result.capabilities.hoverProvider).toBe(true);
      expect(result.capabilities.definitionProvider).toBe(true);
      expect(result.capabilities.signatureHelpProvider).toBe(true);
    });

    it('shutdown completes without error', async () => {
      await server.initialize({});
      await expect(server.shutdown()).resolves.toBeUndefined();
    });

    it('double shutdown is safe', async () => {
      await server.initialize({});
      await server.shutdown();
      await expect(server.shutdown()).resolves.toBeUndefined();
    });
  });

  describe('textDocument/didOpen notification', () => {
    it('registers file in VFS', async () => {
      await server.initialize({});

      server.handleNotification('textDocument/didOpen', {
        textDocument: {
          uri: TEST_URI,
          languageId: 'elixir',
          version: 1,
          text: 'defmodule MyApp do\nend',
        },
      });

      const file = vfs.getFile(TEST_URI);
      expect(file).not.toBeNull();
      expect(file!.content).toBe('defmodule MyApp do\nend');
    });
  });

  describe('textDocument/hover', () => {
    it('returns hover info for a module definition', async () => {
      await server.initialize({});

      const code = `defmodule MyApp do
  @moduledoc "The main application module"
end`;

      server.handleNotification('textDocument/didOpen', {
        textDocument: {
          uri: TEST_URI,
          languageId: 'elixir',
          version: 1,
          text: code,
        },
      });

      // Hover over "MyApp" on line 0
      const result = (await server.handleRequest(
        'textDocument/hover',
        makeHoverParams(TEST_URI, 0, 12),
      )) as { contents: { kind: string; value: string } } | null;

      expect(result).not.toBeNull();
      expect(result!.contents.kind).toBe('markdown');
      expect(result!.contents.value).toContain('MyApp');
    });

    it('returns hover info for a function definition', async () => {
      await server.initialize({});

      const code = `defmodule MyApp do
  @doc "Greets a person"
  @spec greet(String.t()) :: String.t()
  def greet(name) do
    "Hello, \#{name}!"
  end
end`;

      server.handleNotification('textDocument/didOpen', {
        textDocument: {
          uri: TEST_URI,
          languageId: 'elixir',
          version: 1,
          text: code,
        },
      });

      // Hover over "greet" on line 3
      const result = (await server.handleRequest(
        'textDocument/hover',
        makeHoverParams(TEST_URI, 3, 7),
      )) as { contents: { kind: string; value: string } } | null;

      expect(result).not.toBeNull();
      expect(result!.contents.kind).toBe('markdown');
      expect(result!.contents.value).toContain('greet');
    });

    it('returns null for empty space', async () => {
      await server.initialize({});

      server.handleNotification('textDocument/didOpen', {
        textDocument: {
          uri: TEST_URI,
          languageId: 'elixir',
          version: 1,
          text: '\n\ndefmodule MyApp do\nend\n',
        },
      });

      const result = await server.handleRequest(
        'textDocument/hover',
        makeHoverParams(TEST_URI, 0, 0),
      );

      expect(result).toBeNull();
    });

    it('returns null for unknown file', async () => {
      await server.initialize({});

      const result = await server.handleRequest(
        'textDocument/hover',
        makeHoverParams('gh-lsp://unknown/file.ex', 0, 0),
      );

      expect(result).toBeNull();
    });

    it('returns hover with spec information', async () => {
      await server.initialize({});

      const code = `defmodule Math do
  @spec add(number(), number()) :: number()
  def add(a, b) do
    a + b
  end
end`;

      server.handleNotification('textDocument/didOpen', {
        textDocument: {
          uri: TEST_URI,
          languageId: 'elixir',
          version: 1,
          text: code,
        },
      });

      // Hover over "add" on line 2
      const result = (await server.handleRequest(
        'textDocument/hover',
        makeHoverParams(TEST_URI, 2, 7),
      )) as { contents: { kind: string; value: string } } | null;

      expect(result).not.toBeNull();
      expect(result!.contents.value).toContain('add');
    });
  });

  describe('textDocument/definition', () => {
    it('returns definition location for a function call', async () => {
      await server.initialize({});

      const code = `defmodule MyApp do
  def greet(name) do
    "Hello, \#{name}!"
  end

  def run do
    greet("world")
  end
end`;

      server.handleNotification('textDocument/didOpen', {
        textDocument: {
          uri: TEST_URI,
          languageId: 'elixir',
          version: 1,
          text: code,
        },
      });

      // Position on "greet" call at line 6
      const result = (await server.handleRequest(
        'textDocument/definition',
        makeDefinitionParams(TEST_URI, 6, 5),
      )) as { uri: string; range: { start: { line: number } } }[];

      expect(result.length).toBeGreaterThanOrEqual(1);
      // Should point to the function definition on line 1
      expect(result[0]!.range.start.line).toBe(1);
    });

    it('returns definition for a module reference across files', async () => {
      await server.initialize({});

      const moduleCode = `defmodule MyApp.Accounts do
  def list_users do
    []
  end
end`;

      const callerCode = `defmodule MyApp.Web do
  def index do
    MyApp.Accounts.list_users()
  end
end`;

      server.handleNotification('textDocument/didOpen', {
        textDocument: {
          uri: TEST_URI_2,
          languageId: 'elixir',
          version: 1,
          text: moduleCode,
        },
      });

      server.handleNotification('textDocument/didOpen', {
        textDocument: {
          uri: TEST_URI,
          languageId: 'elixir',
          version: 1,
          text: callerCode,
        },
      });

      // Position on "MyApp.Accounts" at line 2
      const result = (await server.handleRequest(
        'textDocument/definition',
        makeDefinitionParams(TEST_URI, 2, 8),
      )) as { uri: string; range: { start: { line: number } } }[];

      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it('returns empty array for unknown file', async () => {
      await server.initialize({});

      const result = await server.handleRequest(
        'textDocument/definition',
        makeDefinitionParams('gh-lsp://unknown/file.ex', 0, 0),
      );

      // findDefinitionAt returns an array; null also accepted for unknown file
      expect(result === null || (Array.isArray(result) && result.length === 0)).toBe(true);
    });
  });

  describe('textDocument/signatureHelp', () => {
    it('returns signature help inside function call', async () => {
      await server.initialize({});

      const code = `defmodule MyApp do
  @spec greet(String.t(), keyword()) :: String.t()
  def greet(name, opts \\\\ []) do
    "Hello, \#{name}!"
  end

  def run do
    greet(`;

      server.handleNotification('textDocument/didOpen', {
        textDocument: {
          uri: TEST_URI,
          languageId: 'elixir',
          version: 1,
          text: code,
        },
      });

      // Position after "greet(" on line 7
      const result = (await server.handleRequest(
        'textDocument/signatureHelp',
        makeSignatureHelpParams(TEST_URI, 7, 10),
      )) as {
        signatures: Array<{
          label: string;
          parameters?: Array<{ label: string }>;
        }>;
        activeParameter?: number;
      } | null;

      expect(result).not.toBeNull();
      expect(result!.signatures.length).toBeGreaterThanOrEqual(1);
      expect(result!.signatures[0]!.label).toContain('greet');
    });

    it('returns null when not in a function call', async () => {
      await server.initialize({});

      server.handleNotification('textDocument/didOpen', {
        textDocument: {
          uri: TEST_URI,
          languageId: 'elixir',
          version: 1,
          text: 'defmodule MyApp do\nend',
        },
      });

      const result = await server.handleRequest(
        'textDocument/signatureHelp',
        makeSignatureHelpParams(TEST_URI, 0, 0),
      );

      expect(result).toBeNull();
    });

    it('returns null for unknown file', async () => {
      await server.initialize({});

      const result = await server.handleRequest(
        'textDocument/signatureHelp',
        makeSignatureHelpParams('gh-lsp://unknown/file.ex', 0, 0),
      );

      expect(result).toBeNull();
    });
  });

  describe('unknown methods', () => {
    it('returns null for unknown request method', async () => {
      await server.initialize({});

      const result = await server.handleRequest('textDocument/completion', {
        textDocument: { uri: TEST_URI },
        position: { line: 0, character: 0 },
      });

      expect(result).toBeNull();
    });

    it('returns null when server is not initialized', async () => {
      // Don't call initialize
      const result = await server.handleRequest(
        'textDocument/hover',
        makeHoverParams(TEST_URI, 0, 0),
      );

      expect(result).toBeNull();
    });
  });

  describe('analysis cache', () => {
    it('returns cached analysis for same file version', async () => {
      await server.initialize({});

      const code = `defmodule MyApp do
  def hello do
    :world
  end
end`;

      server.handleNotification('textDocument/didOpen', {
        textDocument: {
          uri: TEST_URI,
          languageId: 'elixir',
          version: 1,
          text: code,
        },
      });

      // First request
      const result1 = await server.handleRequest(
        'textDocument/hover',
        makeHoverParams(TEST_URI, 1, 7),
      );

      // Second request (should use cache)
      const result2 = await server.handleRequest(
        'textDocument/hover',
        makeHoverParams(TEST_URI, 1, 7),
      );

      // Both should return the same result
      expect(result1).toEqual(result2);
    });

    it('invalidates cache when file version changes', async () => {
      await server.initialize({});

      server.handleNotification('textDocument/didOpen', {
        textDocument: {
          uri: TEST_URI,
          languageId: 'elixir',
          version: 1,
          text: `defmodule MyApp do
  def hello do
    :world
  end
end`,
        },
      });

      const result1 = (await server.handleRequest(
        'textDocument/hover',
        makeHoverParams(TEST_URI, 1, 7),
      )) as { contents: { kind: string; value: string } } | null;

      expect(result1).not.toBeNull();
      expect(result1!.contents.value).toContain('hello');

      // Update the file with new content
      vfs.registerFile(
        TEST_URI,
        `defmodule MyApp do
  def goodbye do
    :farewell
  end
end`,
        2,
      );

      const result2 = (await server.handleRequest(
        'textDocument/hover',
        makeHoverParams(TEST_URI, 1, 7),
      )) as { contents: { kind: string; value: string } } | null;

      expect(result2).not.toBeNull();
      expect(result2!.contents.value).toContain('goodbye');
    });
  });
});
