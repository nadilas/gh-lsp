/**
 * Integration tests for the TypeScript language server lifecycle.
 *
 * These tests exercise the full stack: LspWorkerHost → TypeScript server →
 * TypeScript Language Service, verifying that the JSON-RPC protocol correctly
 * drives the language service through initialization, document open, hover,
 * definition, and signature help requests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LspWorkerHost } from '../../src/workers/lsp-worker-host';
import { createTypeScriptServer } from '../../src/workers/servers/typescript-server';
import { VirtualFileSystem } from '../../src/workers/vfs';
import {
  createJsonRpcRequest,
  createJsonRpcNotification,
} from '../../src/workers/lsp-worker';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const FILE_URI = 'gh-lsp://testowner/testrepo/main/src/index.ts';

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

  const host = new LspWorkerHost(createTypeScriptServer, vfs, postMessage);

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
  languageId = 'typescript',
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

describe('TypeScript Server Integration — Lifecycle', () => {
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

describe('TypeScript Server Integration — Hover', () => {
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

  it('returns hover info for a const declaration', async () => {
    await openDocument(host, FILE_URI, 'const message = "hello world";');

    await host.handleMessage(
      createJsonRpcRequest(2, 'textDocument/hover', {
        textDocument: { uri: FILE_URI },
        position: { line: 0, character: 7 },
      }),
    );

    const response = messages[0]!;
    expect(response.id).toBe(2);

    const result = response.result as {
      contents: { kind: string; value: string };
    };
    expect(result).not.toBeNull();
    expect(result.contents.kind).toBe('markdown');
    expect(result.contents.value).toContain('message');
    expect(result.contents.value).toContain('"hello world"');
  });

  it('returns hover info for a function with explicit types', async () => {
    const code = `function add(a: number, b: number): number {
  return a + b;
}`;

    await openDocument(host, FILE_URI, code);

    await host.handleMessage(
      createJsonRpcRequest(2, 'textDocument/hover', {
        textDocument: { uri: FILE_URI },
        position: { line: 0, character: 10 },
      }),
    );

    const result = messages[0]!.result as {
      contents: { value: string };
    };
    expect(result.contents.value).toContain('add');
    expect(result.contents.value).toContain('number');
  });

  it('returns hover info for a type-annotated variable', async () => {
    const code = `interface Config {
  port: number;
  host: string;
}
const config: Config = { port: 3000, host: "localhost" };`;

    await openDocument(host, FILE_URI, code);

    // Hover over "config"
    await host.handleMessage(
      createJsonRpcRequest(2, 'textDocument/hover', {
        textDocument: { uri: FILE_URI },
        position: { line: 4, character: 8 },
      }),
    );

    const result = messages[0]!.result as {
      contents: { value: string };
    };
    expect(result.contents.value).toContain('Config');
  });

  it('returns hover with range information', async () => {
    await openDocument(host, FILE_URI, 'const x = 42;');

    await host.handleMessage(
      createJsonRpcRequest(2, 'textDocument/hover', {
        textDocument: { uri: FILE_URI },
        position: { line: 0, character: 6 },
      }),
    );

    const result = messages[0]!.result as {
      contents: { value: string };
      range: {
        start: { line: number; character: number };
        end: { line: number; character: number };
      };
    };
    expect(result.range).toBeDefined();
    expect(result.range.start.line).toBe(0);
    expect(result.range.start.character).toBe(6);
    expect(result.range.end.character).toBe(7); // 'x' is 1 char
  });

  it('returns null for whitespace', async () => {
    await openDocument(host, FILE_URI, '   \nconst x = 1;');

    await host.handleMessage(
      createJsonRpcRequest(2, 'textDocument/hover', {
        textDocument: { uri: FILE_URI },
        position: { line: 0, character: 0 },
      }),
    );

    expect(messages[0]!.result).toBeNull();
  });

  it('handles hover on arrow functions', async () => {
    const code = `const greet = (name: string): string => \`Hello, \${name}\`;`;

    await openDocument(host, FILE_URI, code);

    await host.handleMessage(
      createJsonRpcRequest(2, 'textDocument/hover', {
        textDocument: { uri: FILE_URI },
        position: { line: 0, character: 7 },
      }),
    );

    const result = messages[0]!.result as {
      contents: { value: string };
    };
    expect(result.contents.value).toContain('greet');
    expect(result.contents.value).toContain('string');
  });
});

describe('TypeScript Server Integration — Definition', () => {
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

  it('finds definition of a variable reference', async () => {
    const code = `const target = 42;
const ref = target;`;

    await openDocument(host, FILE_URI, code);

    await host.handleMessage(
      createJsonRpcRequest(2, 'textDocument/definition', {
        textDocument: { uri: FILE_URI },
        position: { line: 1, character: 13 },
      }),
    );

    const result = messages[0]!.result as Array<{
      uri: string;
      range: { start: { line: number; character: number } };
    }>;

    expect(result).toHaveLength(1);
    expect(result[0]!.uri).toBe(FILE_URI);
    expect(result[0]!.range.start.line).toBe(0);
  });

  it('finds definition of a function call', async () => {
    const code = `function helper() { return 1; }
const result = helper();`;

    await openDocument(host, FILE_URI, code);

    await host.handleMessage(
      createJsonRpcRequest(2, 'textDocument/definition', {
        textDocument: { uri: FILE_URI },
        position: { line: 1, character: 16 },
      }),
    );

    const result = messages[0]!.result as Array<{
      uri: string;
      range: { start: { line: number } };
    }>;

    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0]!.range.start.line).toBe(0);
  });

  it('finds definition of an interface property', async () => {
    const code = `interface User {
  name: string;
  age: number;
}
function greet(user: User) {
  return user.name;
}`;

    await openDocument(host, FILE_URI, code);

    // Go-to-definition on "name" in user.name
    await host.handleMessage(
      createJsonRpcRequest(2, 'textDocument/definition', {
        textDocument: { uri: FILE_URI },
        position: { line: 5, character: 14 },
      }),
    );

    const result = messages[0]!.result as Array<{
      range: { start: { line: number } };
    }>;

    expect(result.length).toBeGreaterThanOrEqual(1);
    // Should point to line 1 where "name: string" is declared
    expect(result[0]!.range.start.line).toBe(1);
  });

  it('returns empty array for literal values', async () => {
    await openDocument(host, FILE_URI, 'const x = 42;');

    await host.handleMessage(
      createJsonRpcRequest(2, 'textDocument/definition', {
        textDocument: { uri: FILE_URI },
        position: { line: 0, character: 11 },
      }),
    );

    const result = messages[0]!.result as unknown[];
    expect(result).toHaveLength(0);
  });
});

describe('TypeScript Server Integration — Signature Help', () => {
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
    const code = `function greet(name: string, greeting: string): string {
  return greeting + " " + name;
}
greet(`;

    await openDocument(host, FILE_URI, code);

    await host.handleMessage(
      createJsonRpcRequest(2, 'textDocument/signatureHelp', {
        textDocument: { uri: FILE_URI },
        position: { line: 3, character: 6 },
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
    expect(result.signatures).toHaveLength(1);
    expect(result.signatures[0]!.label).toContain('greet');
    expect(result.signatures[0]!.parameters).toHaveLength(2);
    expect(result.activeParameter).toBe(0);
  });

  it('tracks active parameter as cursor moves', async () => {
    const code = `function add(a: number, b: number): number {
  return a + b;
}
add(1, `;

    await openDocument(host, FILE_URI, code);

    await host.handleMessage(
      createJsonRpcRequest(2, 'textDocument/signatureHelp', {
        textDocument: { uri: FILE_URI },
        position: { line: 3, character: 7 },
      }),
    );

    const result = messages[0]!.result as {
      activeParameter?: number;
    };

    expect(result).not.toBeNull();
    expect(result.activeParameter).toBe(1);
  });

  it('returns null when not in a function call', async () => {
    await openDocument(host, FILE_URI, 'const x = 42;');

    await host.handleMessage(
      createJsonRpcRequest(2, 'textDocument/signatureHelp', {
        textDocument: { uri: FILE_URI },
        position: { line: 0, character: 0 },
      }),
    );

    expect(messages[0]!.result).toBeNull();
  });

  it('includes parameter documentation when available', async () => {
    const code = `/**
 * Adds two numbers.
 * @param a - The first number
 * @param b - The second number
 */
function add(a: number, b: number): number {
  return a + b;
}
add(`;

    await openDocument(host, FILE_URI, code);

    await host.handleMessage(
      createJsonRpcRequest(2, 'textDocument/signatureHelp', {
        textDocument: { uri: FILE_URI },
        position: { line: 8, character: 4 },
      }),
    );

    const result = messages[0]!.result as {
      signatures: Array<{
        documentation?: { kind: string; value: string };
        parameters?: Array<{
          label: string;
          documentation?: { kind: string; value: string };
        }>;
      }>;
    };

    expect(result).not.toBeNull();
    expect(result.signatures[0]!.documentation).toBeDefined();
    expect(result.signatures[0]!.documentation!.value).toContain(
      'Adds two numbers',
    );
  });
});

describe('TypeScript Server Integration — JavaScript Support', () => {
  let host: LspWorkerHost;
  let messages: CollectedMessage[];

  const JS_URI = 'gh-lsp://testowner/testrepo/main/src/utils.js';

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

  it('provides hover for JavaScript files', async () => {
    await openDocument(host, JS_URI, 'function hello() { return 42; }', 'javascript');

    await host.handleMessage(
      createJsonRpcRequest(2, 'textDocument/hover', {
        textDocument: { uri: JS_URI },
        position: { line: 0, character: 10 },
      }),
    );

    const result = messages[0]!.result as {
      contents: { value: string };
    };
    expect(result).not.toBeNull();
    expect(result.contents.value).toContain('hello');
  });

  it('provides definition for JavaScript files', async () => {
    const code = `function helper() { return 1; }
const val = helper();`;

    await openDocument(host, JS_URI, code, 'javascript');

    await host.handleMessage(
      createJsonRpcRequest(2, 'textDocument/definition', {
        textDocument: { uri: JS_URI },
        position: { line: 1, character: 14 },
      }),
    );

    const result = messages[0]!.result as Array<{
      range: { start: { line: number } };
    }>;
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});

describe('TypeScript Server Integration — Error Handling', () => {
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
        textDocument: { uri: 'gh-lsp://unknown/file.ts' },
        position: { line: 0, character: 0 },
      }),
    );

    expect(messages[0]!.result).toBeNull();
  });
});
