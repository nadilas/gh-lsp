/**
 * Integration tests for the Go language server lifecycle.
 *
 * These tests exercise the full stack: LspWorkerHost → Go server →
 * tree-sitter parser, verifying that the JSON-RPC protocol correctly
 * drives the language server through initialization, document open, hover,
 * definition, and shutdown.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolve } from 'path';
import { LspWorkerHost } from '../../src/workers/lsp-worker-host';
import { createGoServer } from '../../src/workers/servers/go-server';
import { VirtualFileSystem } from '../../src/workers/vfs';
import {
  createJsonRpcRequest,
  createJsonRpcNotification,
} from '../../src/workers/lsp-worker';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const FILE_URI = 'gh-lsp://testowner/testrepo/main/main.go';
const GO_GRAMMAR_WASM = resolve(
  process.cwd(),
  'node_modules/tree-sitter-go/tree-sitter-go.wasm',
);

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

  const host = new LspWorkerHost(
    (vfsInstance) => createGoServer(vfsInstance, { goGrammarWasmUrl: GO_GRAMMAR_WASM }),
    vfs,
    postMessage,
  );

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

  return messages[0]!;
}

function openDocument(
  host: LspWorkerHost,
  uri: string,
  content: string,
) {
  return host.handleMessage(
    createJsonRpcNotification('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId: 'go',
        version: 1,
        text: content,
      },
    }),
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Go Server Integration — Lifecycle', () => {
  let host: LspWorkerHost;
  let messages: CollectedMessage[];

  beforeEach(() => {
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
    it('completes the initialize handshake with Go capabilities', async () => {
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
      expect(result.capabilities.signatureHelpProvider).toBe(false);
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

describe('Go Server Integration — Hover', () => {
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

  it('returns hover info for a function declaration', async () => {
    const code = `package main

func Add(a, b int) int {
	return a + b
}
`;

    await openDocument(host, FILE_URI, code);

    await host.handleMessage(
      createJsonRpcRequest(2, 'textDocument/hover', {
        textDocument: { uri: FILE_URI },
        position: { line: 2, character: 5 },
      }),
    );

    const response = messages[0]!;
    expect(response.id).toBe(2);

    const result = response.result as {
      contents: { kind: string; value: string };
    };
    expect(result).not.toBeNull();
    expect(result.contents.kind).toBe('markdown');
    expect(result.contents.value).toContain('func Add');
    expect(result.contents.value).toContain('int');
  });

  it('returns hover info for a variable declaration', async () => {
    const code = 'package main\n\nvar count int = 42\n';

    await openDocument(host, FILE_URI, code);

    await host.handleMessage(
      createJsonRpcRequest(2, 'textDocument/hover', {
        textDocument: { uri: FILE_URI },
        position: { line: 2, character: 4 },
      }),
    );

    const result = messages[0]!.result as {
      contents: { value: string };
    };
    expect(result).not.toBeNull();
    expect(result.contents.value).toContain('var count int');
  });

  it('returns hover info for a struct type', async () => {
    const code = `package main

type User struct {
	Name string
	Age  int
}
`;

    await openDocument(host, FILE_URI, code);

    await host.handleMessage(
      createJsonRpcRequest(2, 'textDocument/hover', {
        textDocument: { uri: FILE_URI },
        position: { line: 2, character: 5 },
      }),
    );

    const result = messages[0]!.result as {
      contents: { value: string };
    };
    expect(result).not.toBeNull();
    expect(result.contents.value).toContain('type User struct');
  });

  it('returns null for whitespace', async () => {
    await openDocument(host, FILE_URI, 'package main\n\n\nvar x int = 1\n');

    await host.handleMessage(
      createJsonRpcRequest(2, 'textDocument/hover', {
        textDocument: { uri: FILE_URI },
        position: { line: 2, character: 0 },
      }),
    );

    expect(messages[0]!.result).toBeNull();
  });
});

describe('Go Server Integration — Definition', () => {
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

  it('finds definition of a function call', async () => {
    const code = `package main

func Add(a, b int) int { return a + b }

func main() {
	_ = Add(1, 2)
}
`;

    await openDocument(host, FILE_URI, code);

    await host.handleMessage(
      createJsonRpcRequest(2, 'textDocument/definition', {
        textDocument: { uri: FILE_URI },
        position: { line: 5, character: 5 },
      }),
    );

    const result = messages[0]!.result as Array<{
      uri: string;
      range: { start: { line: number; character: number } };
    }>;

    expect(result).toHaveLength(1);
    expect(result[0]!.uri).toBe(FILE_URI);
    expect(result[0]!.range.start.line).toBe(2);
  });

  it('finds definition of a variable reference', async () => {
    const code = `package main

var target int = 42

func main() {
	_ = target
}
`;

    await openDocument(host, FILE_URI, code);

    await host.handleMessage(
      createJsonRpcRequest(2, 'textDocument/definition', {
        textDocument: { uri: FILE_URI },
        position: { line: 5, character: 5 },
      }),
    );

    const result = messages[0]!.result as Array<{
      uri: string;
      range: { start: { line: number } };
    }>;

    expect(result).toHaveLength(1);
    expect(result[0]!.range.start.line).toBe(2);
  });

  it('returns empty array for literal values', async () => {
    await openDocument(host, FILE_URI, 'package main\n\nvar x int = 42\n');

    await host.handleMessage(
      createJsonRpcRequest(2, 'textDocument/definition', {
        textDocument: { uri: FILE_URI },
        position: { line: 2, character: 12 },
      }),
    );

    const result = messages[0]!.result as unknown[];
    expect(result).toHaveLength(0);
  });
});

describe('Go Server Integration — Error Handling', () => {
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
        textDocument: { uri: 'gh-lsp://unknown/file.go' },
        position: { line: 0, character: 0 },
      }),
    );

    expect(messages[0]!.result).toBeNull();
  });
});
