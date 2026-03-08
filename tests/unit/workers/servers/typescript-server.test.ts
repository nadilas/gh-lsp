import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createTypeScriptServer,
  positionToOffset,
  offsetToPosition,
} from '../../../../src/workers/servers/typescript-server';
import { VirtualFileSystem } from '../../../../src/workers/vfs';
import type { WasmServer } from '../../../../src/workers/language-registry';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TEST_URI = 'gh-lsp://owner/repo/main/src/index.ts';
const JS_URI = 'gh-lsp://owner/repo/main/src/utils.js';

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

function makeSignatureHelpParams(
  uri: string,
  line: number,
  character: number,
) {
  return {
    textDocument: { uri },
    position: { line, character },
  };
}

// ─── Position Conversion Tests ───────────────────────────────────────────────

describe('positionToOffset', () => {
  it('converts first line, first character', () => {
    expect(positionToOffset('hello\nworld', 0, 0)).toBe(0);
  });

  it('converts first line, mid character', () => {
    expect(positionToOffset('hello\nworld', 0, 3)).toBe(3);
  });

  it('converts second line, first character', () => {
    expect(positionToOffset('hello\nworld', 1, 0)).toBe(6);
  });

  it('converts second line, mid character', () => {
    expect(positionToOffset('hello\nworld', 1, 3)).toBe(9);
  });

  it('clamps character to line length', () => {
    expect(positionToOffset('hi\nthere', 0, 100)).toBe(2);
  });

  it('handles single line', () => {
    expect(positionToOffset('hello', 0, 2)).toBe(2);
  });

  it('handles empty content', () => {
    expect(positionToOffset('', 0, 0)).toBe(0);
  });
});

describe('offsetToPosition', () => {
  it('converts offset 0 to (0, 0)', () => {
    expect(offsetToPosition('hello\nworld', 0)).toEqual({
      line: 0,
      character: 0,
    });
  });

  it('converts mid-first-line offset', () => {
    expect(offsetToPosition('hello\nworld', 3)).toEqual({
      line: 0,
      character: 3,
    });
  });

  it('converts start of second line', () => {
    expect(offsetToPosition('hello\nworld', 6)).toEqual({
      line: 1,
      character: 0,
    });
  });

  it('converts mid-second-line offset', () => {
    expect(offsetToPosition('hello\nworld', 9)).toEqual({
      line: 1,
      character: 3,
    });
  });

  it('handles end of content', () => {
    expect(offsetToPosition('hello\nworld', 11)).toEqual({
      line: 1,
      character: 5,
    });
  });
});

// ─── Server Lifecycle Tests ──────────────────────────────────────────────────

describe('createTypeScriptServer', () => {
  let vfs: VirtualFileSystem;
  let server: WasmServer;

  beforeEach(async () => {
    vfs = new VirtualFileSystem();
    server = await createTypeScriptServer(vfs);
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

    it('registers minimal lib in VFS on initialize', async () => {
      await server.initialize({});

      expect(vfs.hasFile('/__lib/lib.d.ts')).toBe(true);
    });

    it('shutdown disposes the service without error', async () => {
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
          languageId: 'typescript',
          version: 1,
          text: 'const x = 1;',
        },
      });

      const file = vfs.getFile(TEST_URI);
      expect(file).not.toBeNull();
      expect(file!.content).toBe('const x = 1;');
    });
  });

  describe('textDocument/hover', () => {
    it('returns hover info for a variable declaration', async () => {
      await server.initialize({});

      server.handleNotification('textDocument/didOpen', {
        textDocument: {
          uri: TEST_URI,
          languageId: 'typescript',
          version: 1,
          text: 'const greeting = "hello";',
        },
      });

      const result = (await server.handleRequest(
        'textDocument/hover',
        makeHoverParams(TEST_URI, 0, 7),
      )) as { contents: { kind: string; value: string } } | null;

      expect(result).not.toBeNull();
      expect(result!.contents.kind).toBe('markdown');
      expect(result!.contents.value).toContain('greeting');
    });

    it('returns hover info for a function declaration', async () => {
      await server.initialize({});

      const code = `function add(a: number, b: number): number {
  return a + b;
}`;

      server.handleNotification('textDocument/didOpen', {
        textDocument: {
          uri: TEST_URI,
          languageId: 'typescript',
          version: 1,
          text: code,
        },
      });

      const result = (await server.handleRequest(
        'textDocument/hover',
        makeHoverParams(TEST_URI, 0, 10),
      )) as { contents: { kind: string; value: string } } | null;

      expect(result).not.toBeNull();
      expect(result!.contents.value).toContain('add');
      expect(result!.contents.value).toContain('number');
    });

    it('returns hover info for an interface', async () => {
      await server.initialize({});

      const code = `interface User {
  name: string;
  age: number;
}
const user: User = { name: "Alice", age: 30 };`;

      server.handleNotification('textDocument/didOpen', {
        textDocument: {
          uri: TEST_URI,
          languageId: 'typescript',
          version: 1,
          text: code,
        },
      });

      // Hover over "user" variable
      const result = (await server.handleRequest(
        'textDocument/hover',
        makeHoverParams(TEST_URI, 4, 7),
      )) as { contents: { kind: string; value: string } } | null;

      expect(result).not.toBeNull();
      expect(result!.contents.value).toContain('User');
    });

    it('returns null for empty space', async () => {
      await server.initialize({});

      server.handleNotification('textDocument/didOpen', {
        textDocument: {
          uri: TEST_URI,
          languageId: 'typescript',
          version: 1,
          text: '\n\nconst x = 1;\n',
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
        makeHoverParams('gh-lsp://unknown/file.ts', 0, 0),
      );

      expect(result).toBeNull();
    });

    it('includes range in hover result', async () => {
      await server.initialize({});

      server.handleNotification('textDocument/didOpen', {
        textDocument: {
          uri: TEST_URI,
          languageId: 'typescript',
          version: 1,
          text: 'const myVar = 42;',
        },
      });

      const result = (await server.handleRequest(
        'textDocument/hover',
        makeHoverParams(TEST_URI, 0, 8),
      )) as {
        contents: { kind: string; value: string };
        range?: { start: { line: number; character: number }; end: { line: number; character: number } };
      } | null;

      expect(result).not.toBeNull();
      expect(result!.range).toBeDefined();
      expect(result!.range!.start.line).toBe(0);
    });
  });

  describe('textDocument/definition', () => {
    it('returns definition location for a variable', async () => {
      await server.initialize({});

      const code = `const target = 42;
const ref = target;`;

      server.handleNotification('textDocument/didOpen', {
        textDocument: {
          uri: TEST_URI,
          languageId: 'typescript',
          version: 1,
          text: code,
        },
      });

      // Hover over "target" on line 1 (the reference)
      const result = (await server.handleRequest(
        'textDocument/definition',
        makeDefinitionParams(TEST_URI, 1, 13),
      )) as { uri: string; range: { start: { line: number } } }[];

      expect(result).toHaveLength(1);
      expect(result[0]!.uri).toBe(TEST_URI);
      expect(result[0]!.range.start.line).toBe(0);
    });

    it('returns definition for function reference', async () => {
      await server.initialize({});

      const code = `function greet(name: string): string {
  return "Hello, " + name;
}
const message = greet("world");`;

      server.handleNotification('textDocument/didOpen', {
        textDocument: {
          uri: TEST_URI,
          languageId: 'typescript',
          version: 1,
          text: code,
        },
      });

      // "greet" on the call site (line 3)
      const result = (await server.handleRequest(
        'textDocument/definition',
        makeDefinitionParams(TEST_URI, 3, 18),
      )) as { uri: string; range: { start: { line: number } } }[];

      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result[0]!.range.start.line).toBe(0);
    });

    it('returns empty array for literal value', async () => {
      await server.initialize({});

      server.handleNotification('textDocument/didOpen', {
        textDocument: {
          uri: TEST_URI,
          languageId: 'typescript',
          version: 1,
          text: 'const x = 42;',
        },
      });

      // Position on "42" literal
      const result = (await server.handleRequest(
        'textDocument/definition',
        makeDefinitionParams(TEST_URI, 0, 11),
      )) as unknown[];

      expect(result).toHaveLength(0);
    });

    it('returns empty array for unknown file', async () => {
      await server.initialize({});

      const result = (await server.handleRequest(
        'textDocument/definition',
        makeDefinitionParams('gh-lsp://unknown/file.ts', 0, 0),
      )) as unknown[];

      expect(result).toHaveLength(0);
    });
  });

  describe('textDocument/signatureHelp', () => {
    it('returns signature help inside function call', async () => {
      await server.initialize({});

      const code = `function add(a: number, b: number): number {
  return a + b;
}
add(`;

      server.handleNotification('textDocument/didOpen', {
        textDocument: {
          uri: TEST_URI,
          languageId: 'typescript',
          version: 1,
          text: code,
        },
      });

      // Position after "add(" on line 3
      const result = (await server.handleRequest(
        'textDocument/signatureHelp',
        makeSignatureHelpParams(TEST_URI, 3, 4),
      )) as {
        signatures: Array<{
          label: string;
          parameters?: Array<{ label: string }>;
        }>;
        activeParameter?: number;
      } | null;

      expect(result).not.toBeNull();
      expect(result!.signatures).toHaveLength(1);
      expect(result!.signatures[0]!.label).toContain('add');
      expect(result!.signatures[0]!.parameters).toBeDefined();
      expect(result!.signatures[0]!.parameters!.length).toBe(2);
    });

    it('returns correct active parameter index', async () => {
      await server.initialize({});

      const code = `function add(a: number, b: number): number {
  return a + b;
}
add(1, `;

      server.handleNotification('textDocument/didOpen', {
        textDocument: {
          uri: TEST_URI,
          languageId: 'typescript',
          version: 1,
          text: code,
        },
      });

      // Position after "add(1, " — second parameter
      const result = (await server.handleRequest(
        'textDocument/signatureHelp',
        makeSignatureHelpParams(TEST_URI, 3, 7),
      )) as { activeParameter?: number } | null;

      expect(result).not.toBeNull();
      expect(result!.activeParameter).toBe(1);
    });

    it('returns null when not in a function call', async () => {
      await server.initialize({});

      server.handleNotification('textDocument/didOpen', {
        textDocument: {
          uri: TEST_URI,
          languageId: 'typescript',
          version: 1,
          text: 'const x = 1;',
        },
      });

      const result = await server.handleRequest(
        'textDocument/signatureHelp',
        makeSignatureHelpParams(TEST_URI, 0, 0),
      );

      expect(result).toBeNull();
    });
  });

  describe('JavaScript support', () => {
    it('provides hover for JavaScript files', async () => {
      await server.initialize({});

      server.handleNotification('textDocument/didOpen', {
        textDocument: {
          uri: JS_URI,
          languageId: 'javascript',
          version: 1,
          text: 'function hello() { return 42; }',
        },
      });

      const result = (await server.handleRequest(
        'textDocument/hover',
        makeHoverParams(JS_URI, 0, 10),
      )) as { contents: { kind: string; value: string } } | null;

      expect(result).not.toBeNull();
      expect(result!.contents.value).toContain('hello');
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

    it('returns null when service is not initialized', async () => {
      // Don't call initialize — service is null
      const result = await server.handleRequest(
        'textDocument/hover',
        makeHoverParams(TEST_URI, 0, 0),
      );

      expect(result).toBeNull();
    });
  });
});
