import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { resolve } from 'path';
import { createGoServer } from '../../../../src/workers/servers/go-server';
import { VirtualFileSystem } from '../../../../src/workers/vfs';
import type { WasmServer } from '../../../../src/workers/language-registry';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const GO_URI = 'gh-lsp://owner/repo/main/src/main.go';
const GO_WASM_PATH = resolve(
  __dirname,
  '../../../../node_modules/tree-sitter-go/tree-sitter-go.wasm',
);

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

function openDocument(
  server: WasmServer,
  uri: string,
  text: string,
) {
  server.handleNotification('textDocument/didOpen', {
    textDocument: { uri, languageId: 'go', version: 1, text },
  });
}

// ─── Test Suites ─────────────────────────────────────────────────────────────

describe('createGoServer', () => {
  let vfs: VirtualFileSystem;
  let server: WasmServer;

  beforeAll(async () => {
    // Parser.init() only needs to be called once globally
  });

  beforeEach(async () => {
    vfs = new VirtualFileSystem();
    server = await createGoServer(vfs, { goGrammarWasmUrl: GO_WASM_PATH });
  });

  afterEach(async () => {
    await server.shutdown();
  });

  // ─── Lifecycle ───────────────────────────────────────────────────────

  describe('lifecycle', () => {
    it('returns capabilities on initialize', async () => {
      const result = (await server.initialize({})) as {
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

  // ─── didOpen ─────────────────────────────────────────────────────────

  describe('textDocument/didOpen', () => {
    it('registers file in VFS', async () => {
      await server.initialize({});
      openDocument(server, GO_URI, 'package main\n');
      expect(vfs.hasFile(GO_URI)).toBe(true);
    });
  });

  // ─── Hover ───────────────────────────────────────────────────────────

  describe('textDocument/hover', () => {
    beforeEach(async () => {
      await server.initialize({});
    });

    it('returns null for unknown file', async () => {
      const result = await server.handleRequest(
        'textDocument/hover',
        makeHoverParams('gh-lsp://unknown', 0, 0),
      );
      expect(result).toBeNull();
    });

    it('returns null for whitespace/empty area', async () => {
      openDocument(server, GO_URI, 'package main\n\n\n');
      const result = await server.handleRequest(
        'textDocument/hover',
        makeHoverParams(GO_URI, 2, 0),
      );
      // Hovering on blank line — the named descendant is probably
      // source_file which is not an identifier
      expect(result).toBeNull();
    });

    it('hover on function declaration shows signature', async () => {
      const code = 'package main\n\nfunc Add(a, b int) int { return a + b }\n';
      openDocument(server, GO_URI, code);
      // Hover on "Add" — line 2, character 5
      const result = (await server.handleRequest(
        'textDocument/hover',
        makeHoverParams(GO_URI, 2, 5),
      )) as { contents: { kind: string; value: string }; range?: unknown } | null;
      expect(result).not.toBeNull();
      expect(result!.contents.kind).toBe('markdown');
      expect(result!.contents.value).toContain('```go');
      expect(result!.contents.value).toContain('func Add(a, b int) int');
      expect(result!.range).toBeDefined();
    });

    it('hover on function with doc comment includes documentation', async () => {
      const code = [
        'package main',
        '',
        '// Add adds two numbers together',
        'func Add(a, b int) int { return a + b }',
      ].join('\n');
      openDocument(server, GO_URI, code);
      // Hover on "Add" — line 3, character 5
      const result = (await server.handleRequest(
        'textDocument/hover',
        makeHoverParams(GO_URI, 3, 5),
      )) as { contents: { kind: string; value: string } } | null;
      expect(result).not.toBeNull();
      expect(result!.contents.value).toContain('Add adds two numbers together');
    });

    it('hover on variable declaration shows type', async () => {
      const code = 'package main\n\nvar x int = 42\n';
      openDocument(server, GO_URI, code);
      // Hover on "x" — line 2, character 4
      const result = (await server.handleRequest(
        'textDocument/hover',
        makeHoverParams(GO_URI, 2, 4),
      )) as { contents: { kind: string; value: string } } | null;
      expect(result).not.toBeNull();
      expect(result!.contents.value).toContain('var x int');
    });

    it('hover on struct type shows definition', async () => {
      const code = [
        'package main',
        '',
        'type User struct {',
        '    Name string',
        '    Age  int',
        '}',
      ].join('\n');
      openDocument(server, GO_URI, code);
      // Hover on "User" — line 2, character 5
      const result = (await server.handleRequest(
        'textDocument/hover',
        makeHoverParams(GO_URI, 2, 5),
      )) as { contents: { kind: string; value: string } } | null;
      expect(result).not.toBeNull();
      expect(result!.contents.value).toContain('type User struct');
    });

    it('hover on method shows receiver and signature', async () => {
      const code = [
        'package main',
        '',
        'type User struct { Name string }',
        '',
        'func (u User) String() string { return u.Name }',
      ].join('\n');
      openDocument(server, GO_URI, code);
      // Hover on "String" method name — line 4
      const result = (await server.handleRequest(
        'textDocument/hover',
        makeHoverParams(GO_URI, 4, 14),
      )) as { contents: { kind: string; value: string } } | null;
      expect(result).not.toBeNull();
      expect(result!.contents.value).toContain('func (u User) String() string');
    });

    it('hover on interface shows definition', async () => {
      const code = [
        'package main',
        '',
        'type Reader interface {',
        '    Read(p []byte) (int, error)',
        '}',
      ].join('\n');
      openDocument(server, GO_URI, code);
      // Hover on "Reader" — line 2, character 5
      const result = (await server.handleRequest(
        'textDocument/hover',
        makeHoverParams(GO_URI, 2, 5),
      )) as { contents: { kind: string; value: string } } | null;
      expect(result).not.toBeNull();
      expect(result!.contents.value).toContain('type Reader interface');
    });

    it('hover on constant shows value', async () => {
      const code = 'package main\n\nconst Pi = 3.14159\n';
      openDocument(server, GO_URI, code);
      // Hover on "Pi" — line 2, character 6
      const result = (await server.handleRequest(
        'textDocument/hover',
        makeHoverParams(GO_URI, 2, 6),
      )) as { contents: { kind: string; value: string } } | null;
      expect(result).not.toBeNull();
      expect(result!.contents.value).toContain('const Pi');
      expect(result!.contents.value).toContain('3.14159');
    });

    it('hover result includes range', async () => {
      const code = 'package main\n\nfunc Hello() {}\n';
      openDocument(server, GO_URI, code);
      // Hover on "Hello" — line 2, character 5
      const result = (await server.handleRequest(
        'textDocument/hover',
        makeHoverParams(GO_URI, 2, 5),
      )) as { range: { start: { line: number; character: number }; end: { line: number; character: number } } } | null;
      expect(result).not.toBeNull();
      expect(result!.range).toBeDefined();
      expect(result!.range.start.line).toBe(2);
      expect(result!.range.end.line).toBe(2);
    });

    it('hover on function parameter shows type', async () => {
      const code = [
        'package main',
        '',
        'func Greet(name string) {',
        '    _ = name',
        '}',
      ].join('\n');
      openDocument(server, GO_URI, code);
      // Hover on the parameter "name" in function body — line 3, character 8
      const result = (await server.handleRequest(
        'textDocument/hover',
        makeHoverParams(GO_URI, 3, 8),
      )) as { contents: { kind: string; value: string } } | null;
      expect(result).not.toBeNull();
      expect(result!.contents.value).toContain('name string');
    });

    it('hover on short var declaration shows assignment', async () => {
      const code = [
        'package main',
        '',
        'func main() {',
        '    x := 42',
        '}',
      ].join('\n');
      openDocument(server, GO_URI, code);
      // Hover on "x" — line 3
      const result = (await server.handleRequest(
        'textDocument/hover',
        makeHoverParams(GO_URI, 3, 4),
      )) as { contents: { kind: string; value: string } } | null;
      expect(result).not.toBeNull();
      expect(result!.contents.value).toContain(':=');
    });
  });

  // ─── Definition ──────────────────────────────────────────────────────

  describe('textDocument/definition', () => {
    beforeEach(async () => {
      await server.initialize({});
    });

    it('returns empty array for unknown file', async () => {
      const result = await server.handleRequest(
        'textDocument/definition',
        makeDefinitionParams('gh-lsp://unknown', 0, 0),
      );
      expect(result).toEqual([]);
    });

    it('returns empty array for literals', async () => {
      const code = 'package main\n\nvar x = 42\n';
      openDocument(server, GO_URI, code);
      // Hover on "42" — a literal, not an identifier
      const result = await server.handleRequest(
        'textDocument/definition',
        makeDefinitionParams(GO_URI, 2, 9),
      );
      expect(result).toEqual([]);
    });

    it('go-to-definition on function call finds declaration', async () => {
      const code = [
        'package main',
        '',
        'func Add(a, b int) int { return a + b }',
        '',
        'func main() {',
        '    _ = Add(1, 2)',
        '}',
      ].join('\n');
      openDocument(server, GO_URI, code);
      // Click on "Add" in `Add(1, 2)` — line 5
      const result = (await server.handleRequest(
        'textDocument/definition',
        makeDefinitionParams(GO_URI, 5, 8),
      )) as { uri: string; range: { start: { line: number; character: number } } }[];
      expect(result).toHaveLength(1);
      expect(result[0]!.uri).toBe(GO_URI);
      // Definition should point to line 2 where `func Add` is declared
      expect(result[0]!.range.start.line).toBe(2);
    });

    it('go-to-definition on variable reference finds declaration', async () => {
      const code = [
        'package main',
        '',
        'var count int = 0',
        '',
        'func main() {',
        '    _ = count',
        '}',
      ].join('\n');
      openDocument(server, GO_URI, code);
      // Click on "count" in `_ = count` — line 5
      const result = (await server.handleRequest(
        'textDocument/definition',
        makeDefinitionParams(GO_URI, 5, 8),
      )) as { uri: string; range: { start: { line: number; character: number } } }[];
      expect(result).toHaveLength(1);
      expect(result[0]!.range.start.line).toBe(2);
    });

    it('go-to-definition on type reference finds declaration', async () => {
      const code = [
        'package main',
        '',
        'type Point struct { X, Y int }',
        '',
        'func NewPoint() Point { return Point{} }',
      ].join('\n');
      openDocument(server, GO_URI, code);
      // Click on "Point" in return type — line 4
      // "Point" starts at column 16: func NewPoint() Point
      const result = (await server.handleRequest(
        'textDocument/definition',
        makeDefinitionParams(GO_URI, 4, 17),
      )) as { uri: string; range: { start: { line: number } } }[];
      expect(result.length).toBeGreaterThanOrEqual(1);
      // Should point to line 2 where `type Point struct` is declared
      expect(result[0]!.range.start.line).toBe(2);
    });
  });

  // ─── Unknown methods ─────────────────────────────────────────────────

  describe('unsupported methods', () => {
    it('returns null for unknown request method', async () => {
      await server.initialize({});
      const result = await server.handleRequest('textDocument/completion', {});
      expect(result).toBeNull();
    });
  });
});
