import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createRustServer,
  positionToOffset,
  offsetToPosition,
  getTokenAtOffset,
  parseRustDeclarations,
} from '../../../../src/workers/servers/rust-server';
import { VirtualFileSystem } from '../../../../src/workers/vfs';
import type { WasmServer } from '../../../../src/workers/language-registry';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TEST_URI = 'gh-lsp://owner/repo/main/src/main.rs';
const OTHER_URI = 'gh-lsp://owner/repo/main/src/lib.rs';

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

// ─── Position Conversion Tests ───────────────────────────────────────────────

describe('positionToOffset (Rust server)', () => {
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

describe('offsetToPosition (Rust server)', () => {
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

// ─── Token Extraction Tests ─────────────────────────────────────────────────

describe('getTokenAtOffset', () => {
  it('extracts identifier at offset', () => {
    expect(getTokenAtOffset('fn hello() {}', 3)).toBe('hello');
  });

  it('returns null for whitespace', () => {
    expect(getTokenAtOffset('fn hello() {}', 2)).toBeNull();
  });

  it('returns null for punctuation', () => {
    expect(getTokenAtOffset('fn hello() {}', 8)).toBeNull();
  });

  it('returns null for out-of-bounds offset', () => {
    expect(getTokenAtOffset('hello', -1)).toBeNull();
    expect(getTokenAtOffset('hello', 100)).toBeNull();
  });

  it('extracts token at start of content', () => {
    expect(getTokenAtOffset('hello world', 0)).toBe('hello');
  });

  it('extracts token at end of content', () => {
    expect(getTokenAtOffset('hello world', 10)).toBe('world');
  });
});

// ─── Declaration Parser Tests ───────────────────────────────────────────────

describe('parseRustDeclarations', () => {
  it('parses function declarations', () => {
    const code = 'fn add(a: i32, b: i32) -> i32 {\n  a + b\n}';
    const decls = parseRustDeclarations(code, TEST_URI);
    expect(decls).toHaveLength(1);
    expect(decls[0]!.kind).toBe('function');
    expect(decls[0]!.name).toBe('add');
    expect(decls[0]!.signature).toContain('fn add');
  });

  it('parses pub function declarations', () => {
    const code = 'pub fn greet(name: &str) -> String {';
    const decls = parseRustDeclarations(code, TEST_URI);
    expect(decls).toHaveLength(1);
    expect(decls[0]!.kind).toBe('function');
    expect(decls[0]!.name).toBe('greet');
    expect(decls[0]!.signature).toContain('pub fn greet');
  });

  it('parses struct declarations', () => {
    const code = 'pub struct Point {\n  x: f64,\n  y: f64,\n}';
    const decls = parseRustDeclarations(code, TEST_URI);
    expect(decls).toHaveLength(1);
    expect(decls[0]!.kind).toBe('struct');
    expect(decls[0]!.name).toBe('Point');
  });

  it('parses enum declarations', () => {
    const code = 'pub enum Color {\n  Red,\n  Green,\n  Blue,\n}';
    const decls = parseRustDeclarations(code, TEST_URI);
    expect(decls).toHaveLength(1);
    expect(decls[0]!.kind).toBe('enum');
    expect(decls[0]!.name).toBe('Color');
  });

  it('parses trait declarations', () => {
    const code = 'pub trait Display {\n  fn fmt(&self) -> String;\n}';
    const decls = parseRustDeclarations(code, TEST_URI);
    // trait + fn inside
    const traitDecl = decls.find((d) => d.kind === 'trait');
    expect(traitDecl).toBeDefined();
    expect(traitDecl!.name).toBe('Display');
  });

  it('parses type alias declarations', () => {
    const code = 'pub type Result<T> = std::result::Result<T, Error>;';
    const decls = parseRustDeclarations(code, TEST_URI);
    expect(decls).toHaveLength(1);
    expect(decls[0]!.kind).toBe('type');
    expect(decls[0]!.name).toBe('Result');
  });

  it('parses const declarations', () => {
    const code = 'pub const MAX_SIZE: usize = 1024;';
    const decls = parseRustDeclarations(code, TEST_URI);
    expect(decls).toHaveLength(1);
    expect(decls[0]!.kind).toBe('const');
    expect(decls[0]!.name).toBe('MAX_SIZE');
  });

  it('parses static declarations', () => {
    const code = 'static mut COUNTER: u32 = 0;';
    const decls = parseRustDeclarations(code, TEST_URI);
    expect(decls).toHaveLength(1);
    expect(decls[0]!.kind).toBe('static');
    expect(decls[0]!.name).toBe('COUNTER');
  });

  it('parses mod declarations', () => {
    const code = 'pub mod utils;';
    const decls = parseRustDeclarations(code, TEST_URI);
    expect(decls).toHaveLength(1);
    expect(decls[0]!.kind).toBe('mod');
    expect(decls[0]!.name).toBe('utils');
  });

  it('parses impl blocks', () => {
    const code = 'impl Point {\n  fn new() -> Self { todo!() }\n}';
    const decls = parseRustDeclarations(code, TEST_URI);
    const implDecl = decls.find((d) => d.kind === 'impl');
    expect(implDecl).toBeDefined();
    expect(implDecl!.name).toBe('Point');
  });

  it('parses impl trait for type', () => {
    const code = 'impl Display for Point {\n  fn fmt(&self) -> String { todo!() }\n}';
    const decls = parseRustDeclarations(code, TEST_URI);
    const implDecl = decls.find((d) => d.kind === 'impl');
    expect(implDecl).toBeDefined();
    expect(implDecl!.name).toBe('Point');
  });

  it('captures doc comments', () => {
    const code = '/// Adds two numbers.\n/// Returns the sum.\nfn add(a: i32, b: i32) -> i32 {';
    const decls = parseRustDeclarations(code, TEST_URI);
    expect(decls).toHaveLength(1);
    expect(decls[0]!.documentation).toContain('Adds two numbers.');
    expect(decls[0]!.documentation).toContain('Returns the sum.');
  });

  it('returns empty array for empty content', () => {
    expect(parseRustDeclarations('', TEST_URI)).toHaveLength(0);
  });

  it('handles async fn', () => {
    const code = 'pub async fn fetch_data() -> Result<()> {';
    const decls = parseRustDeclarations(code, TEST_URI);
    expect(decls).toHaveLength(1);
    expect(decls[0]!.kind).toBe('function');
    expect(decls[0]!.name).toBe('fetch_data');
  });

  it('handles unsafe fn', () => {
    const code = 'pub unsafe fn dangerous() {';
    const decls = parseRustDeclarations(code, TEST_URI);
    expect(decls).toHaveLength(1);
    expect(decls[0]!.kind).toBe('function');
    expect(decls[0]!.name).toBe('dangerous');
  });
});

// ─── Server Lifecycle Tests ──────────────────────────────────────────────────

describe('createRustServer', () => {
  let vfs: VirtualFileSystem;
  let server: WasmServer;

  beforeEach(async () => {
    vfs = new VirtualFileSystem();
    server = await createRustServer(vfs);
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
      expect(result.capabilities.signatureHelpProvider).toBe(false);
    });

    it('shutdown is safe', async () => {
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
          languageId: 'rust',
          version: 1,
          text: 'fn main() {}',
        },
      });

      const file = vfs.getFile(TEST_URI);
      expect(file).not.toBeNull();
      expect(file!.content).toBe('fn main() {}');
    });
  });

  describe('textDocument/hover', () => {
    it('returns hover info for a function declaration', async () => {
      await server.initialize({});

      const code = 'fn add(a: i32, b: i32) -> i32 {\n  a + b\n}';

      server.handleNotification('textDocument/didOpen', {
        textDocument: {
          uri: TEST_URI,
          languageId: 'rust',
          version: 1,
          text: code,
        },
      });

      const result = (await server.handleRequest(
        'textDocument/hover',
        makeHoverParams(TEST_URI, 0, 3),
      )) as { contents: { kind: string; value: string } } | null;

      expect(result).not.toBeNull();
      expect(result!.contents.kind).toBe('markdown');
      expect(result!.contents.value).toContain('fn add');
      expect(result!.contents.value).toContain('```rust');
    });

    it('returns hover info for a struct declaration', async () => {
      await server.initialize({});

      const code = 'pub struct Point {\n  x: f64,\n  y: f64,\n}';

      server.handleNotification('textDocument/didOpen', {
        textDocument: {
          uri: TEST_URI,
          languageId: 'rust',
          version: 1,
          text: code,
        },
      });

      const result = (await server.handleRequest(
        'textDocument/hover',
        makeHoverParams(TEST_URI, 0, 12),
      )) as { contents: { kind: string; value: string } } | null;

      expect(result).not.toBeNull();
      expect(result!.contents.value).toContain('struct Point');
    });

    it('returns hover info for an enum declaration', async () => {
      await server.initialize({});

      const code = 'pub enum Color {\n  Red,\n  Green,\n  Blue,\n}';

      server.handleNotification('textDocument/didOpen', {
        textDocument: {
          uri: TEST_URI,
          languageId: 'rust',
          version: 1,
          text: code,
        },
      });

      const result = (await server.handleRequest(
        'textDocument/hover',
        makeHoverParams(TEST_URI, 0, 10),
      )) as { contents: { kind: string; value: string } } | null;

      expect(result).not.toBeNull();
      expect(result!.contents.value).toContain('enum Color');
    });

    it('returns hover info for a trait declaration', async () => {
      await server.initialize({});

      const code = 'pub trait Drawable {\n  fn draw(&self);\n}';

      server.handleNotification('textDocument/didOpen', {
        textDocument: {
          uri: TEST_URI,
          languageId: 'rust',
          version: 1,
          text: code,
        },
      });

      const result = (await server.handleRequest(
        'textDocument/hover',
        makeHoverParams(TEST_URI, 0, 11),
      )) as { contents: { kind: string; value: string } } | null;

      expect(result).not.toBeNull();
      expect(result!.contents.value).toContain('trait Drawable');
    });

    it('returns hover info for a const declaration', async () => {
      await server.initialize({});

      const code = 'pub const MAX_SIZE: usize = 1024;';

      server.handleNotification('textDocument/didOpen', {
        textDocument: {
          uri: TEST_URI,
          languageId: 'rust',
          version: 1,
          text: code,
        },
      });

      const result = (await server.handleRequest(
        'textDocument/hover',
        makeHoverParams(TEST_URI, 0, 12),
      )) as { contents: { kind: string; value: string } } | null;

      expect(result).not.toBeNull();
      expect(result!.contents.value).toContain('MAX_SIZE');
    });

    it('returns hover info for a static declaration', async () => {
      await server.initialize({});

      const code = 'static mut COUNTER: u32 = 0;';

      server.handleNotification('textDocument/didOpen', {
        textDocument: {
          uri: TEST_URI,
          languageId: 'rust',
          version: 1,
          text: code,
        },
      });

      const result = (await server.handleRequest(
        'textDocument/hover',
        makeHoverParams(TEST_URI, 0, 13),
      )) as { contents: { kind: string; value: string } } | null;

      expect(result).not.toBeNull();
      expect(result!.contents.value).toContain('COUNTER');
    });

    it('returns hover info for a type alias', async () => {
      await server.initialize({});

      const code = 'pub type Result<T> = std::result::Result<T, Error>;';

      server.handleNotification('textDocument/didOpen', {
        textDocument: {
          uri: TEST_URI,
          languageId: 'rust',
          version: 1,
          text: code,
        },
      });

      const result = (await server.handleRequest(
        'textDocument/hover',
        makeHoverParams(TEST_URI, 0, 9),
      )) as { contents: { kind: string; value: string } } | null;

      expect(result).not.toBeNull();
      expect(result!.contents.value).toContain('type Result');
    });

    it('returns hover with doc comments', async () => {
      await server.initialize({});

      const code = '/// Adds two numbers together.\n/// Returns the sum.\nfn add(a: i32, b: i32) -> i32 {\n  a + b\n}';

      server.handleNotification('textDocument/didOpen', {
        textDocument: {
          uri: TEST_URI,
          languageId: 'rust',
          version: 1,
          text: code,
        },
      });

      const result = (await server.handleRequest(
        'textDocument/hover',
        makeHoverParams(TEST_URI, 2, 3),
      )) as { contents: { kind: string; value: string } } | null;

      expect(result).not.toBeNull();
      expect(result!.contents.value).toContain('Adds two numbers together.');
      expect(result!.contents.value).toContain('Returns the sum.');
      expect(result!.contents.value).toContain('fn add');
    });

    it('returns null for whitespace/empty positions', async () => {
      await server.initialize({});

      server.handleNotification('textDocument/didOpen', {
        textDocument: {
          uri: TEST_URI,
          languageId: 'rust',
          version: 1,
          text: '\n\nfn main() {}\n',
        },
      });

      const result = await server.handleRequest(
        'textDocument/hover',
        makeHoverParams(TEST_URI, 0, 0),
      );

      expect(result).toBeNull();
    });

    it('returns null for unknown files', async () => {
      await server.initialize({});

      const result = await server.handleRequest(
        'textDocument/hover',
        makeHoverParams('gh-lsp://unknown/file.rs', 0, 0),
      );

      expect(result).toBeNull();
    });

    it('returns null for keywords', async () => {
      await server.initialize({});

      server.handleNotification('textDocument/didOpen', {
        textDocument: {
          uri: TEST_URI,
          languageId: 'rust',
          version: 1,
          text: 'fn main() {}',
        },
      });

      // Position on "fn" keyword
      const result = await server.handleRequest(
        'textDocument/hover',
        makeHoverParams(TEST_URI, 0, 0),
      );

      expect(result).toBeNull();
    });

    it('includes range in hover result', async () => {
      await server.initialize({});

      const code = 'fn hello() {}';

      server.handleNotification('textDocument/didOpen', {
        textDocument: {
          uri: TEST_URI,
          languageId: 'rust',
          version: 1,
          text: code,
        },
      });

      const result = (await server.handleRequest(
        'textDocument/hover',
        makeHoverParams(TEST_URI, 0, 4),
      )) as {
        contents: { kind: string; value: string };
        range?: {
          start: { line: number; character: number };
          end: { line: number; character: number };
        };
      } | null;

      expect(result).not.toBeNull();
      expect(result!.range).toBeDefined();
      expect(result!.range!.start.line).toBe(0);
      expect(result!.range!.start.character).toBe(3);
      expect(result!.range!.end.character).toBe(8);
    });

    it('returns hover for a reference to a known symbol', async () => {
      await server.initialize({});

      const code = 'struct Point { x: f64, y: f64 }\nfn use_point() {\n  let p: Point = todo!();\n}';

      server.handleNotification('textDocument/didOpen', {
        textDocument: {
          uri: TEST_URI,
          languageId: 'rust',
          version: 1,
          text: code,
        },
      });

      // Hover over "Point" on line 2 (the reference in type annotation)
      const result = (await server.handleRequest(
        'textDocument/hover',
        makeHoverParams(TEST_URI, 2, 9),
      )) as { contents: { kind: string; value: string } } | null;

      expect(result).not.toBeNull();
      expect(result!.contents.value).toContain('struct Point');
    });
  });

  describe('textDocument/definition', () => {
    it('returns definition location for a function reference', async () => {
      await server.initialize({});

      const code = 'fn greet() {}\nfn main() {\n  greet();\n}';

      server.handleNotification('textDocument/didOpen', {
        textDocument: {
          uri: TEST_URI,
          languageId: 'rust',
          version: 1,
          text: code,
        },
      });

      // "greet" on line 2 (the call site)
      const result = (await server.handleRequest(
        'textDocument/definition',
        makeDefinitionParams(TEST_URI, 2, 3),
      )) as { uri: string; range: { start: { line: number } } }[];

      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result[0]!.uri).toBe(TEST_URI);
      expect(result[0]!.range.start.line).toBe(0);
    });

    it('returns definition location for a struct reference', async () => {
      await server.initialize({});

      const code = 'struct Point { x: f64 }\nfn main() {\n  let p: Point = todo!();\n}';

      server.handleNotification('textDocument/didOpen', {
        textDocument: {
          uri: TEST_URI,
          languageId: 'rust',
          version: 1,
          text: code,
        },
      });

      // "Point" on line 2
      const result = (await server.handleRequest(
        'textDocument/definition',
        makeDefinitionParams(TEST_URI, 2, 9),
      )) as { uri: string; range: { start: { line: number } } }[];

      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result[0]!.range.start.line).toBe(0);
    });

    it('returns definition for cross-file reference', async () => {
      await server.initialize({});

      // File 1: declares the function
      server.handleNotification('textDocument/didOpen', {
        textDocument: {
          uri: OTHER_URI,
          languageId: 'rust',
          version: 1,
          text: 'pub fn helper() -> i32 {\n  42\n}',
        },
      });

      // File 2: references the function
      server.handleNotification('textDocument/didOpen', {
        textDocument: {
          uri: TEST_URI,
          languageId: 'rust',
          version: 1,
          text: 'fn main() {\n  helper();\n}',
        },
      });

      // "helper" on line 1 in main.rs
      const result = (await server.handleRequest(
        'textDocument/definition',
        makeDefinitionParams(TEST_URI, 1, 3),
      )) as { uri: string; range: { start: { line: number } } }[];

      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result[0]!.uri).toBe(OTHER_URI);
      expect(result[0]!.range.start.line).toBe(0);
    });

    it('returns empty array for unknown symbols', async () => {
      await server.initialize({});

      server.handleNotification('textDocument/didOpen', {
        textDocument: {
          uri: TEST_URI,
          languageId: 'rust',
          version: 1,
          text: 'fn main() {\n  unknown_fn();\n}',
        },
      });

      // "unknown_fn" has no declaration
      const result = (await server.handleRequest(
        'textDocument/definition',
        makeDefinitionParams(TEST_URI, 1, 5),
      )) as unknown[];

      expect(result).toHaveLength(0);
    });

    it('returns empty array for unknown files', async () => {
      await server.initialize({});

      const result = (await server.handleRequest(
        'textDocument/definition',
        makeDefinitionParams('gh-lsp://unknown/file.rs', 0, 0),
      )) as unknown[];

      expect(result).toHaveLength(0);
    });

    it('returns definition for items in impl blocks', async () => {
      await server.initialize({});

      const code = 'struct Point { x: f64 }\nimpl Point {\n  fn new() -> Self { todo!() }\n}\nfn main() {\n  Point::new();\n}';

      server.handleNotification('textDocument/didOpen', {
        textDocument: {
          uri: TEST_URI,
          languageId: 'rust',
          version: 1,
          text: code,
        },
      });

      // "new" on line 5 (the call site)
      const result = (await server.handleRequest(
        'textDocument/definition',
        makeDefinitionParams(TEST_URI, 5, 10),
      )) as { uri: string; range: { start: { line: number } } }[];

      expect(result.length).toBeGreaterThanOrEqual(1);
      // Should find "fn new" on line 2
      expect(result[0]!.range.start.line).toBe(2);
    });

    it('returns empty array for keywords', async () => {
      await server.initialize({});

      server.handleNotification('textDocument/didOpen', {
        textDocument: {
          uri: TEST_URI,
          languageId: 'rust',
          version: 1,
          text: 'fn main() {}',
        },
      });

      const result = (await server.handleRequest(
        'textDocument/definition',
        makeDefinitionParams(TEST_URI, 0, 0),
      )) as unknown[];

      expect(result).toHaveLength(0);
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
});
