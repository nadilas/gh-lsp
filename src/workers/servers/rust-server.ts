/**
 * Rust language server using regex-based syntax analysis.
 *
 * Provides hover and go-to-definition for Rust code by parsing declarations
 * (functions, structs, enums, traits, type aliases, constants, statics, impls,
 * modules) and building a symbol table from all files in the VFS.
 *
 * The server parses Rust source line-by-line, extracting declarations with
 * their signatures and doc comments. It does not require WASM — all analysis
 * runs as plain JavaScript in a Web Worker.
 *
 *   textDocument/hover       → symbol lookup + formatted markdown
 *   textDocument/definition  → symbol table resolution across files
 */

import type { WasmServer } from '../language-registry';
import type { VirtualFileSystem } from '../vfs';

// ─── LSP Parameter Types ─────────────────────────────────────────────────────

interface TextDocumentIdentifier {
  uri: string;
}

interface Position {
  line: number;
  character: number;
}

interface TextDocumentPositionParams {
  textDocument: TextDocumentIdentifier;
  position: Position;
}

interface DidOpenTextDocumentParams {
  textDocument: {
    uri: string;
    languageId: string;
    version: number;
    text: string;
  };
}

// ─── Rust Declaration Types ──────────────────────────────────────────────────

export type RustDeclarationKind =
  | 'function'
  | 'struct'
  | 'enum'
  | 'trait'
  | 'type'
  | 'const'
  | 'static'
  | 'impl'
  | 'mod'
  | 'use';

export interface RustDeclaration {
  kind: RustDeclarationKind;
  name: string;
  signature: string;
  documentation: string;
  startOffset: number;
  endOffset: number;
  line: number;
  character: number;
  uri: string;
}

// ─── Position Conversion ─────────────────────────────────────────────────────

/**
 * Converts an LSP position (line, character) to a byte offset
 * (number of characters from the start of the file).
 */
export function positionToOffset(
  content: string,
  line: number,
  character: number,
): number {
  const lines = content.split('\n');
  let offset = 0;

  for (let i = 0; i < line && i < lines.length; i++) {
    offset += lines[i]!.length + 1; // +1 for newline
  }

  const currentLineLength = lines[line]?.length ?? 0;
  return offset + Math.min(character, currentLineLength);
}

/**
 * Converts a byte offset to an LSP position (line, character).
 */
export function offsetToPosition(
  content: string,
  offset: number,
): Position {
  const lines = content.split('\n');
  let remaining = offset;

  for (let line = 0; line < lines.length; line++) {
    if (remaining <= lines[line]!.length) {
      return { line, character: remaining };
    }
    remaining -= lines[line]!.length + 1;
  }

  // Past end of file — return last position
  const lastLine = lines.length - 1;
  return { line: lastLine, character: lines[lastLine]?.length ?? 0 };
}

// ─── Token Extraction ────────────────────────────────────────────────────────

const RUST_KEYWORDS = new Set([
  'as', 'async', 'await', 'break', 'const', 'continue', 'crate', 'dyn',
  'else', 'enum', 'extern', 'false', 'fn', 'for', 'if', 'impl', 'in',
  'let', 'loop', 'match', 'mod', 'move', 'mut', 'pub', 'ref', 'return',
  'self', 'Self', 'static', 'struct', 'super', 'trait', 'true', 'type',
  'unsafe', 'use', 'where', 'while', 'yield',
]);

/**
 * Extracts the identifier token at the given byte offset.
 * Returns null if the offset points to whitespace, punctuation, or is out of bounds.
 */
export function getTokenAtOffset(
  content: string,
  offset: number,
): string | null {
  if (offset < 0 || offset >= content.length) return null;

  const ch = content[offset]!;
  if (!/[a-zA-Z0-9_]/.test(ch)) return null;

  let start = offset;
  while (start > 0 && /[a-zA-Z0-9_]/.test(content[start - 1]!)) {
    start--;
  }

  let end = offset;
  while (end < content.length - 1 && /[a-zA-Z0-9_]/.test(content[end + 1]!)) {
    end++;
  }

  return content.slice(start, end + 1);
}

// ─── Declaration Parser ──────────────────────────────────────────────────────

/**
 * Patterns for detecting Rust declarations. Tested against trimmed lines.
 * Order matters: function must come before const/static since `const fn` exists.
 */
const DECLARATION_PATTERNS: Array<{
  kind: RustDeclarationKind;
  pattern: RegExp;
  nameGroup: number;
}> = [
  {
    kind: 'function',
    pattern:
      /^(?:pub(?:\([^)]*\))?\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s+"[^"]*"\s+)?fn\s+(\w+)/,
    nameGroup: 1,
  },
  {
    kind: 'struct',
    pattern: /^(?:pub(?:\([^)]*\))?\s+)?struct\s+(\w+)/,
    nameGroup: 1,
  },
  {
    kind: 'enum',
    pattern: /^(?:pub(?:\([^)]*\))?\s+)?enum\s+(\w+)/,
    nameGroup: 1,
  },
  {
    kind: 'trait',
    pattern: /^(?:pub(?:\([^)]*\))?\s+)?(?:unsafe\s+)?trait\s+(\w+)/,
    nameGroup: 1,
  },
  {
    kind: 'type',
    pattern: /^(?:pub(?:\([^)]*\))?\s+)?type\s+(\w+)/,
    nameGroup: 1,
  },
  {
    kind: 'const',
    pattern: /^(?:pub(?:\([^)]*\))?\s+)?const\s+(\w+)/,
    nameGroup: 1,
  },
  {
    kind: 'static',
    pattern: /^(?:pub(?:\([^)]*\))?\s+)?static\s+(?:mut\s+)?(\w+)/,
    nameGroup: 1,
  },
  {
    kind: 'mod',
    pattern: /^(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)/,
    nameGroup: 1,
  },
];

/** Impl blocks are handled separately due to their different structure. */
const IMPL_PATTERN =
  /^(?:unsafe\s+)?impl(?:<[^>]*>)?\s+(?:(\w+)(?:<[^>]*>)?\s+for\s+)?(\w+)/;

/**
 * Extracts the signature from a declaration line.
 * Removes the body opener `{` and trailing whitespace.
 */
function extractSignature(line: string): string {
  let sig = line.trim();
  const braceIdx = sig.indexOf('{');
  if (braceIdx !== -1) {
    sig = sig.slice(0, braceIdx).trim();
  }
  return sig;
}

/**
 * Parses a Rust source file and returns an array of declarations.
 * Extracts functions, structs, enums, traits, type aliases, constants,
 * statics, impl blocks, and modules along with their doc comments.
 */
export function parseRustDeclarations(
  content: string,
  uri: string,
): RustDeclaration[] {
  const lines = content.split('\n');
  const declarations: RustDeclaration[] = [];
  let docLines: string[] = [];
  let offset = 0;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx]!;
    const trimmed = line.trim();

    // Collect doc comments (/// style)
    if (trimmed.startsWith('///')) {
      const commentContent = trimmed.slice(3);
      docLines.push(
        commentContent.startsWith(' ')
          ? commentContent.slice(1)
          : commentContent,
      );
      offset += line.length + 1;
      continue;
    }

    // Preserve doc comments across blank lines and attributes
    if (trimmed === '' || trimmed.startsWith('#[')) {
      offset += line.length + 1;
      continue;
    }

    // Regular comments (// but not ///) reset doc comments
    if (trimmed.startsWith('//')) {
      docLines = [];
      offset += line.length + 1;
      continue;
    }

    // Try each declaration pattern
    let matched = false;

    for (const { kind, pattern, nameGroup } of DECLARATION_PATTERNS) {
      const match = trimmed.match(pattern);
      if (match) {
        const name = match[nameGroup]!;
        const character = line.length - line.trimStart().length;

        declarations.push({
          kind,
          name,
          signature: extractSignature(trimmed),
          documentation: docLines.join('\n'),
          startOffset: offset + character,
          endOffset: offset + line.length,
          line: lineIdx,
          character,
          uri,
        });
        matched = true;
        break;
      }
    }

    // Try impl pattern separately
    if (!matched) {
      const implMatch = trimmed.match(IMPL_PATTERN);
      if (implMatch) {
        const name = implMatch[2]!;
        const character = line.length - line.trimStart().length;

        declarations.push({
          kind: 'impl',
          name,
          signature: extractSignature(trimmed),
          documentation: docLines.join('\n'),
          startOffset: offset + character,
          endOffset: offset + line.length,
          line: lineIdx,
          character,
          uri,
        });
      }
    }

    // Reset doc comments after any non-comment, non-blank, non-attribute line
    docLines = [];
    offset += line.length + 1;
  }

  return declarations;
}

// ─── Hover Formatting ────────────────────────────────────────────────────────

function formatHoverContent(declaration: RustDeclaration): string {
  const codeBlock = `\`\`\`rust\n${declaration.signature}\n\`\`\``;
  if (declaration.documentation) {
    return `${codeBlock}\n---\n${declaration.documentation}`;
  }
  return codeBlock;
}

// ─── Server Factory ──────────────────────────────────────────────────────────

/**
 * Creates a Rust language server backed by the given VFS.
 * Uses regex-based parsing to provide hover and go-to-definition
 * for Rust source files without requiring rust-analyzer WASM.
 */
export async function createRustServer(
  vfs: VirtualFileSystem,
): Promise<WasmServer> {
  let initialized = false;

  /**
   * Collects all declarations from all Rust files currently in the VFS.
   */
  function getAllDeclarations(): RustDeclaration[] {
    const allDeclarations: RustDeclaration[] = [];
    for (const uri of vfs.listFiles()) {
      const file = vfs.getFile(uri);
      if (file) {
        allDeclarations.push(...parseRustDeclarations(file.content, uri));
      }
    }
    return allDeclarations;
  }

  /**
   * Finds the best declaration matching a name.
   * Prefers non-impl declarations (struct/enum/trait/fn) over impl blocks.
   */
  function findDeclaration(name: string): RustDeclaration | null {
    const declarations = getAllDeclarations();
    const nonImpl = declarations.find(
      (d) => d.name === name && d.kind !== 'impl',
    );
    if (nonImpl) return nonImpl;
    return declarations.find((d) => d.name === name) ?? null;
  }

  /**
   * Finds all declarations matching a name, for go-to-definition.
   */
  function findAllDeclarations(name: string): RustDeclaration[] {
    const declarations = getAllDeclarations();
    return declarations.filter((d) => d.name === name);
  }

  function handleHover(
    params: TextDocumentPositionParams,
  ): {
    contents: { kind: string; value: string };
    range?: { start: Position; end: Position };
  } | null {
    const file = vfs.getFile(params.textDocument.uri);
    if (!file) return null;

    const offset = positionToOffset(
      file.content,
      params.position.line,
      params.position.character,
    );

    const token = getTokenAtOffset(file.content, offset);
    if (!token) return null;

    // Don't show hover for keywords
    if (RUST_KEYWORDS.has(token)) return null;

    const declaration = findDeclaration(token);
    if (!declaration) return null;

    // Compute the token's range in the current file
    let tokenStart = offset;
    while (
      tokenStart > 0 &&
      /[a-zA-Z0-9_]/.test(file.content[tokenStart - 1]!)
    ) {
      tokenStart--;
    }
    const tokenEnd = tokenStart + token.length;

    return {
      contents: {
        kind: 'markdown',
        value: formatHoverContent(declaration),
      },
      range: {
        start: offsetToPosition(file.content, tokenStart),
        end: offsetToPosition(file.content, tokenEnd),
      },
    };
  }

  function handleDefinition(
    params: TextDocumentPositionParams,
  ): { uri: string; range: { start: Position; end: Position } }[] {
    const file = vfs.getFile(params.textDocument.uri);
    if (!file) return [];

    const offset = positionToOffset(
      file.content,
      params.position.line,
      params.position.character,
    );

    const token = getTokenAtOffset(file.content, offset);
    if (!token) return [];

    if (RUST_KEYWORDS.has(token)) return [];

    const declarations = findAllDeclarations(token);
    // Prefer non-impl declarations
    const nonImplDecls = declarations.filter((d) => d.kind !== 'impl');
    const resultDecls = nonImplDecls.length > 0 ? nonImplDecls : declarations;

    return resultDecls
      .map((decl) => {
        const declFile = vfs.getFile(decl.uri);
        if (!declFile) return null;

        return {
          uri: decl.uri,
          range: {
            start: { line: decl.line, character: decl.character },
            end: offsetToPosition(declFile.content, decl.endOffset),
          },
        };
      })
      .filter(
        (loc): loc is NonNullable<typeof loc> => loc !== null,
      );
  }

  return {
    async initialize() {
      initialized = true;
      return {
        capabilities: {
          hoverProvider: true,
          definitionProvider: true,
          signatureHelpProvider: false,
        },
      };
    },

    async handleRequest(method: string, params: unknown) {
      if (!initialized) return null;

      switch (method) {
        case 'textDocument/hover':
          return handleHover(params as TextDocumentPositionParams);
        case 'textDocument/definition':
          return handleDefinition(params as TextDocumentPositionParams);
        default:
          return null;
      }
    },

    handleNotification(method: string, params: unknown) {
      switch (method) {
        case 'textDocument/didOpen': {
          const p = params as DidOpenTextDocumentParams;
          vfs.registerFile(
            p.textDocument.uri,
            p.textDocument.text,
            p.textDocument.version,
          );
          break;
        }
      }
    },

    async shutdown() {
      initialized = false;
    },
  };
}
