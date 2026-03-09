/**
 * Integration tests for the Elixir language server lifecycle.
 *
 * These tests exercise the full stack: LspWorkerHost → Elixir server →
 * Elixir analyzer, verifying that the JSON-RPC protocol correctly
 * drives the language service through initialization, document open, hover,
 * definition, and signature help requests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LspWorkerHost } from '../../src/workers/lsp-worker-host';
import { createElixirServer } from '../../src/workers/servers/elixir-server';
import { VirtualFileSystem } from '../../src/workers/vfs';
import {
  createJsonRpcRequest,
  createJsonRpcNotification,
} from '../../src/workers/lsp-worker';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const FILE_URI = 'gh-lsp://testowner/testrepo/main/lib/my_app.ex';
const FILE_URI_2 = 'gh-lsp://testowner/testrepo/main/lib/my_app/accounts.ex';

interface CollectedMessage {
  jsonrpc: string;
  id?: number | string;
  result?: unknown;
  error?: { code: number; message: string };
}

function createTestHost() {
  const vfs = new VirtualFileSystem();
  const messages: CollectedMessage[] = [];
  const postMessage = (msg: unknown) => {
    messages.push(msg as CollectedMessage);
  };

  const host = new LspWorkerHost(createElixirServer, vfs, postMessage);

  return { host, vfs, messages };
}

async function initializeHost(host: LspWorkerHost, messages: CollectedMessage[]) {
  await host.handleMessage(
    createJsonRpcRequest(1, 'initialize', {
      processId: null,
      rootUri: null,
      capabilities: {},
    }),
  );

  await host.handleMessage(createJsonRpcNotification('initialized', {}));

  // Return the initialize response
  return messages[0]!;
}

function openDocument(
  host: LspWorkerHost,
  uri: string,
  content: string,
  languageId = 'elixir',
) {
  return host.handleMessage(
    createJsonRpcNotification('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId,
        version: 1,
        text: content,
      },
    }),
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Elixir Server Integration — Lifecycle', () => {
  let host: LspWorkerHost;
  let messages: CollectedMessage[];

  beforeEach(async () => {
    const setup = createTestHost();
    host = setup.host;
    messages = setup.messages;
  });

  afterEach(async () => {
    if (host.isInitialized) {
      await host.handleMessage(createJsonRpcRequest(999, 'shutdown', null));
    }
  });

  describe('initialize / shutdown', () => {
    it('completes the initialize handshake', async () => {
      const response = await initializeHost(host, messages);

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe(1);

      const result = response.result as {
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

    it('completes a full initialize → shutdown cycle', async () => {
      await initializeHost(host, messages);
      expect(host.isInitialized).toBe(true);

      messages.length = 0;
      await host.handleMessage(createJsonRpcRequest(2, 'shutdown', null));

      expect(host.isInitialized).toBe(false);
      expect(messages[0]!.result).toBeNull();
    });

    it('handles multiple initialize → shutdown cycles', async () => {
      for (let i = 0; i < 3; i++) {
        messages.length = 0;
        await initializeHost(host, messages);
        expect(host.isInitialized).toBe(true);

        await host.handleMessage(
          createJsonRpcRequest(100 + i, 'shutdown', null),
        );
        expect(host.isInitialized).toBe(false);
      }
    });
  });
});

describe('Elixir Server Integration — Hover', () => {
  let host: LspWorkerHost;
  let messages: CollectedMessage[];

  beforeEach(async () => {
    const setup = createTestHost();
    host = setup.host;
    messages = setup.messages;
    await initializeHost(host, messages);
    messages.length = 0;
  });

  afterEach(async () => {
    if (host.isInitialized) {
      await host.handleMessage(createJsonRpcRequest(999, 'shutdown', null));
    }
  });

  it('returns hover info for a module definition', async () => {
    const code = `defmodule MyApp do
  @moduledoc "The main application module"
end`;

    await openDocument(host, FILE_URI, code);

    await host.handleMessage(
      createJsonRpcRequest(2, 'textDocument/hover', {
        textDocument: { uri: FILE_URI },
        position: { line: 0, character: 12 },
      }),
    );

    const response = messages[0]!;
    expect(response.id).toBe(2);

    const result = response.result as {
      contents: { kind: string; value: string };
    };
    expect(result).not.toBeNull();
    expect(result.contents.kind).toBe('markdown');
    expect(result.contents.value).toContain('MyApp');
  });

  it('returns hover info for a function with @spec', async () => {
    const code = `defmodule Math do
  @spec add(number(), number()) :: number()
  def add(a, b) do
    a + b
  end
end`;

    await openDocument(host, FILE_URI, code);

    await host.handleMessage(
      createJsonRpcRequest(2, 'textDocument/hover', {
        textDocument: { uri: FILE_URI },
        position: { line: 2, character: 7 },
      }),
    );

    const result = messages[0]!.result as {
      contents: { kind: string; value: string };
    };
    expect(result).not.toBeNull();
    expect(result.contents.value).toContain('add');
  });

  it('returns hover with @doc documentation', async () => {
    const code = `defmodule Greeter do
  @doc "Greets a person by name"
  def greet(name) do
    "Hello, \#{name}!"
  end
end`;

    await openDocument(host, FILE_URI, code);

    await host.handleMessage(
      createJsonRpcRequest(2, 'textDocument/hover', {
        textDocument: { uri: FILE_URI },
        position: { line: 2, character: 7 },
      }),
    );

    const result = messages[0]!.result as {
      contents: { kind: string; value: string };
    };
    expect(result).not.toBeNull();
    expect(result.contents.value).toContain('greet');
    expect(result.contents.value).toContain('Greets a person by name');
  });

  it('returns null for whitespace', async () => {
    await openDocument(host, FILE_URI, '\n\ndefmodule MyApp do\nend');

    await host.handleMessage(
      createJsonRpcRequest(2, 'textDocument/hover', {
        textDocument: { uri: FILE_URI },
        position: { line: 0, character: 0 },
      }),
    );

    expect(messages[0]!.result).toBeNull();
  });
});

describe('Elixir Server Integration — Definition', () => {
  let host: LspWorkerHost;
  let messages: CollectedMessage[];

  beforeEach(async () => {
    const setup = createTestHost();
    host = setup.host;
    messages = setup.messages;
    await initializeHost(host, messages);
    messages.length = 0;
  });

  afterEach(async () => {
    if (host.isInitialized) {
      await host.handleMessage(createJsonRpcRequest(999, 'shutdown', null));
    }
  });

  it('finds definition of a function call within the same file', async () => {
    const code = `defmodule MyApp do
  def greet(name) do
    "Hello, \#{name}!"
  end

  def run do
    greet("world")
  end
end`;

    await openDocument(host, FILE_URI, code);

    await host.handleMessage(
      createJsonRpcRequest(2, 'textDocument/definition', {
        textDocument: { uri: FILE_URI },
        position: { line: 6, character: 5 },
      }),
    );

    const result = messages[0]!.result as Array<{
      uri: string;
      range: { start: { line: number } };
    }>;

    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0]!.range.start.line).toBe(1);
  });

  it('finds module definition across files', async () => {
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

    await openDocument(host, FILE_URI_2, moduleCode);
    await openDocument(host, FILE_URI, callerCode);

    await host.handleMessage(
      createJsonRpcRequest(2, 'textDocument/definition', {
        textDocument: { uri: FILE_URI },
        position: { line: 2, character: 8 },
      }),
    );

    const result = messages[0]!.result as Array<{
      uri: string;
      range: { start: { line: number } };
    }>;

    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Elixir Server Integration — Signature Help', () => {
  let host: LspWorkerHost;
  let messages: CollectedMessage[];

  beforeEach(async () => {
    const setup = createTestHost();
    host = setup.host;
    messages = setup.messages;
    await initializeHost(host, messages);
    messages.length = 0;
  });

  afterEach(async () => {
    if (host.isInitialized) {
      await host.handleMessage(createJsonRpcRequest(999, 'shutdown', null));
    }
  });

  it('returns signature help inside a function call', async () => {
    const code = `defmodule MyApp do
  @spec greet(String.t(), keyword()) :: String.t()
  def greet(name, opts \\\\ []) do
    "Hello, \#{name}!"
  end

  def run do
    greet(`;

    await openDocument(host, FILE_URI, code);

    await host.handleMessage(
      createJsonRpcRequest(2, 'textDocument/signatureHelp', {
        textDocument: { uri: FILE_URI },
        position: { line: 7, character: 10 },
      }),
    );

    const result = messages[0]!.result as {
      signatures: Array<{
        label: string;
        parameters?: Array<{ label: string }>;
      }>;
      activeSignature?: number;
      activeParameter?: number;
    };

    expect(result).not.toBeNull();
    expect(result.signatures.length).toBeGreaterThanOrEqual(1);
    expect(result.signatures[0]!.label).toContain('greet');
  });

  it('returns null when not in a function call', async () => {
    await openDocument(host, FILE_URI, 'defmodule MyApp do\nend');

    await host.handleMessage(
      createJsonRpcRequest(2, 'textDocument/signatureHelp', {
        textDocument: { uri: FILE_URI },
        position: { line: 0, character: 0 },
      }),
    );

    expect(messages[0]!.result).toBeNull();
  });
});

describe('Elixir Server Integration — Error Handling', () => {
  let host: LspWorkerHost;
  let messages: CollectedMessage[];

  beforeEach(() => {
    const setup = createTestHost();
    host = setup.host;
    messages = setup.messages;
  });

  it('returns ServerNotInitialized for requests before initialize', async () => {
    await host.handleMessage(
      createJsonRpcRequest(1, 'textDocument/hover', {
        textDocument: { uri: FILE_URI },
        position: { line: 0, character: 0 },
      }),
    );

    expect(messages[0]!.error).toBeDefined();
    expect(messages[0]!.error!.code).toBe(-32002);
  });

  it('returns null hover for unregistered files', async () => {
    await initializeHost(host, messages);
    messages.length = 0;

    await host.handleMessage(
      createJsonRpcRequest(2, 'textDocument/hover', {
        textDocument: { uri: 'gh-lsp://unknown/file.ex' },
        position: { line: 0, character: 0 },
      }),
    );

    expect(messages[0]!.result).toBeNull();
  });
});
