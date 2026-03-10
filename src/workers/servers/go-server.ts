/**
 * Go language server adapter.
 *
 * Uses web-tree-sitter with the Go grammar to provide hover and
 * go-to-definition. Since gopls cannot run in a browser, this server
 * parses Go source with tree-sitter and walks the AST to resolve
 * identifiers, extract type information, and locate declarations.
 *
 * The adapter translates LSP methods to tree-sitter AST operations:
 *   textDocument/hover      → find node at position, resolve declaration, format signature
 *   textDocument/definition → find node at position, locate declaration site
 */

import {
  Parser,
  Language,
  type Node as SyntaxNode,
  type Tree,
} from 'web-tree-sitter';
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

// ─── Server Options ──────────────────────────────────────────────────────────

export interface GoServerOptions {
  /** Override URL/path for tree-sitter-go.wasm (for tests or custom deployments). */
  goGrammarWasmUrl?: string;
}

// ─── AST Helpers ─────────────────────────────────────────────────────────────

function isIdentifierLike(node: SyntaxNode): boolean {
  return (
    node.type === 'identifier' ||
    node.type === 'type_identifier' ||
    node.type === 'field_identifier' ||
    node.type === 'package_identifier'
  );
}

/**
 * Extract Go-style doc comments that immediately precede a declaration.
 * In Go, doc comments are contiguous // lines (or a single /* block)
 * directly above the declaration with no blank lines in between.
 */
function extractDocComment(node: SyntaxNode): string {
  const comments: string[] = [];
  let sibling = node.previousNamedSibling;

  while (sibling && sibling.type === 'comment') {
    const text = sibling.text;
    if (text.startsWith('//')) {
      comments.unshift(text.slice(2).trimStart());
    } else if (text.startsWith('/*') && text.endsWith('*/')) {
      comments.unshift(text.slice(2, -2).trim());
    }
    sibling = sibling.previousNamedSibling;
  }

  return comments.join('\n');
}

// ─── Signature Formatting ────────────────────────────────────────────────────

function formatFunctionSignature(node: SyntaxNode): string {
  const name = node.childForFieldName('name')?.text ?? '';
  const params = node.childForFieldName('parameters')?.text ?? '()';
  const result = node.childForFieldName('result');
  return `func ${name}${params}${result ? ' ' + result.text : ''}`;
}

function formatMethodSignature(node: SyntaxNode): string {
  const receiver = node.childForFieldName('receiver')?.text ?? '';
  const name = node.childForFieldName('name')?.text ?? '';
  const params = node.childForFieldName('parameters')?.text ?? '()';
  const result = node.childForFieldName('result');
  return `func ${receiver} ${name}${params}${result ? ' ' + result.text : ''}`;
}

function formatTypeSignature(typeSpec: SyntaxNode): string {
  const name = typeSpec.childForFieldName('name')?.text ?? '';
  const typeNode = typeSpec.childForFieldName('type');
  if (!typeNode) return `type ${name}`;
  return `type ${name} ${typeNode.text}`;
}

function formatVarSignature(varSpec: SyntaxNode): string {
  const names = varSpec.childrenForFieldName('name').map((n) => n.text);
  const typeNode = varSpec.childForFieldName('type');
  const valueNode = varSpec.childrenForFieldName('value');

  let sig = `var ${names.join(', ')}`;
  if (typeNode) sig += ` ${typeNode.text}`;
  if (valueNode.length > 0) sig += ` = ${valueNode.map((v) => v.text).join(', ')}`;
  return sig;
}

function formatConstSignature(constSpec: SyntaxNode): string {
  const names = constSpec.childrenForFieldName('name').map((n) => n.text);
  const typeNode = constSpec.childForFieldName('type');
  const valueNode = constSpec.childrenForFieldName('value');

  let sig = `const ${names.join(', ')}`;
  if (typeNode) sig += ` ${typeNode.text}`;
  if (valueNode.length > 0) sig += ` = ${valueNode.map((v) => v.text).join(', ')}`;
  return sig;
}

function formatShortVarSignature(node: SyntaxNode): string {
  const left = node.childForFieldName('left');
  const right = node.childForFieldName('right');
  if (left && right) return `${left.text} := ${right.text}`;
  return node.text;
}

// ─── Declaration Info ────────────────────────────────────────────────────────

interface DeclInfo {
  /** The AST node of the declaration. */
  node: SyntaxNode;
  /** Formatted Go signature for hover display. */
  signature: string;
  /** Doc comment text preceding the declaration. */
  docComment: string;
}

/**
 * If `node` is (or contains) a declaration of `name`, return its info.
 */
function getDeclarationInfo(
  node: SyntaxNode,
  name: string,
): DeclInfo | null {
  switch (node.type) {
    case 'function_declaration': {
      if (node.childForFieldName('name')?.text === name) {
        return {
          node,
          signature: formatFunctionSignature(node),
          docComment: extractDocComment(node),
        };
      }
      break;
    }
    case 'method_declaration': {
      if (node.childForFieldName('name')?.text === name) {
        return {
          node,
          signature: formatMethodSignature(node),
          docComment: extractDocComment(node),
        };
      }
      break;
    }
    case 'type_spec': {
      if (node.childForFieldName('name')?.text === name) {
        const docTarget =
          node.parent?.type === 'type_declaration' ? node.parent : node;
        return {
          node,
          signature: formatTypeSignature(node),
          docComment: extractDocComment(docTarget),
        };
      }
      break;
    }
    case 'var_spec': {
      const names = node.childrenForFieldName('name');
      if (names.some((n) => n.text === name)) {
        const docTarget =
          node.parent?.type === 'var_declaration' ? node.parent : node;
        return {
          node,
          signature: formatVarSignature(node),
          docComment: extractDocComment(docTarget),
        };
      }
      break;
    }
    case 'const_spec': {
      const names = node.childrenForFieldName('name');
      if (names.some((n) => n.text === name)) {
        const docTarget =
          node.parent?.type === 'const_declaration' ? node.parent : node;
        return {
          node,
          signature: formatConstSignature(node),
          docComment: extractDocComment(docTarget),
        };
      }
      break;
    }
    case 'short_var_declaration': {
      const left = node.childForFieldName('left');
      if (left) {
        for (const child of left.namedChildren) {
          if (child.type === 'identifier' && child.text === name) {
            return {
              node,
              signature: formatShortVarSignature(node),
              docComment: '',
            };
          }
        }
        // Single identifier on left without expression_list wrapper
        if (left.type === 'identifier' && left.text === name) {
          return {
            node,
            signature: formatShortVarSignature(node),
            docComment: '',
          };
        }
      }
      break;
    }
    case 'parameter_declaration': {
      for (const child of node.namedChildren) {
        if (child.type === 'identifier' && child.text === name) {
          const typeNode = node.childForFieldName('type');
          return {
            node,
            signature: typeNode
              ? `${name} ${typeNode.text}`
              : name,
            docComment: '',
          };
        }
      }
      break;
    }
    case 'field_declaration': {
      for (const child of node.namedChildren) {
        if (child.type === 'field_identifier' && child.text === name) {
          const typeNode = node.childForFieldName('type');
          return {
            node,
            signature: typeNode
              ? `${name} ${typeNode.text}`
              : name,
            docComment: extractDocComment(node),
          };
        }
      }
      break;
    }
  }
  return null;
}

// ─── Scope-aware Declaration Search ──────────────────────────────────────────

function findContainingFunction(node: SyntaxNode): SyntaxNode | null {
  let current: SyntaxNode | null = node.parent;
  while (current) {
    if (
      current.type === 'function_declaration' ||
      current.type === 'method_declaration'
    ) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

function findInParameterList(
  paramList: SyntaxNode,
  name: string,
): DeclInfo | null {
  for (const child of paramList.namedChildren) {
    if (child.type === 'parameter_declaration') {
      const result = getDeclarationInfo(child, name);
      if (result) return result;
    }
  }
  return null;
}

/**
 * Search a block (function body) for local declarations that appear
 * before `beforeNode` in source order.
 */
function findLocalDeclaration(
  body: SyntaxNode,
  name: string,
  beforeNode: SyntaxNode,
): DeclInfo | null {
  let found: DeclInfo | null = null;

  for (const stmt of body.namedChildren) {
    if (stmt.startIndex >= beforeNode.startIndex) break;

    switch (stmt.type) {
      case 'var_declaration':
        for (const spec of stmt.namedChildren) {
          if (spec.type === 'var_spec') {
            const r = getDeclarationInfo(spec, name);
            if (r) found = r;
          }
        }
        break;
      case 'short_var_declaration': {
        const r = getDeclarationInfo(stmt, name);
        if (r) found = r;
        break;
      }
      case 'const_declaration':
        for (const spec of stmt.namedChildren) {
          if (spec.type === 'const_spec') {
            const r = getDeclarationInfo(spec, name);
            if (r) found = r;
          }
        }
        break;
    }
  }

  return found;
}

/**
 * Search all top-level declarations in a source file for `name`.
 */
function findTopLevelDeclaration(
  root: SyntaxNode,
  name: string,
): DeclInfo | null {
  for (const child of root.namedChildren) {
    switch (child.type) {
      case 'function_declaration':
      case 'method_declaration': {
        const r = getDeclarationInfo(child, name);
        if (r) return r;
        break;
      }
      case 'type_declaration':
        for (const spec of child.namedChildren) {
          if (spec.type === 'type_spec') {
            const r = getDeclarationInfo(spec, name);
            if (r) return r;
          }
        }
        break;
      case 'var_declaration':
        for (const spec of child.namedChildren) {
          if (spec.type === 'var_spec') {
            const r = getDeclarationInfo(spec, name);
            if (r) return r;
          }
        }
        break;
      case 'const_declaration':
        for (const spec of child.namedChildren) {
          if (spec.type === 'const_spec') {
            const r = getDeclarationInfo(spec, name);
            if (r) return r;
          }
        }
        break;
    }
  }
  return null;
}

/**
 * Search for a field declaration inside any struct type in the file.
 * Used when we can't resolve the struct type of a selector expression.
 */
function findFieldDeclarationAnywhere(
  root: SyntaxNode,
  fieldName: string,
): DeclInfo | null {
  for (const child of root.namedChildren) {
    if (child.type === 'type_declaration') {
      for (const spec of child.namedChildren) {
        if (spec.type === 'type_spec') {
          const typeBody = spec.childForFieldName('type');
          if (typeBody?.type === 'struct_type') {
            // struct_type → field_declaration_list → field_declaration
            for (const listOrField of typeBody.namedChildren) {
              if (listOrField.type === 'field_declaration_list') {
                for (const f of listOrField.namedChildren) {
                  if (f.type === 'field_declaration') {
                    const r = getDeclarationInfo(f, fieldName);
                    if (r) return r;
                  }
                }
              } else if (listOrField.type === 'field_declaration') {
                const r = getDeclarationInfo(listOrField, fieldName);
                if (r) return r;
              }
            }
          }
        }
      }
    }
  }
  return null;
}

/**
 * Resolve an identifier to its declaration, searching scopes from
 * innermost (current block) to outermost (top-level).
 */
function resolveIdentifier(
  root: SyntaxNode,
  identifierNode: SyntaxNode,
): DeclInfo | null {
  const name = identifierNode.text;

  // 1. Check if the node IS the declaration name (hovering on it)
  const parent = identifierNode.parent;
  if (parent) {
    const info = getDeclarationInfo(parent, name);
    if (info) return info;
    // Check grandparent (e.g., type_spec → type_declaration)
    if (parent.parent) {
      const info2 = getDeclarationInfo(parent.parent, name);
      if (info2) return info2;
    }
  }

  // 2. If inside a selector_expression and this is the field part,
  //    try to find the field declaration in structs
  if (
    parent?.type === 'selector_expression' &&
    identifierNode.type === 'field_identifier'
  ) {
    const fieldResult = findFieldDeclarationAnywhere(root, name);
    if (fieldResult) return fieldResult;
  }

  // 3. Check containing function scope
  const containingFunc = findContainingFunction(identifierNode);
  if (containingFunc) {
    // Check parameters
    const params = containingFunc.childForFieldName('parameters');
    if (params) {
      const r = findInParameterList(params, name);
      if (r) return r;
    }

    // Check receiver (for methods)
    const receiver = containingFunc.childForFieldName('receiver');
    if (receiver) {
      const r = findInParameterList(receiver, name);
      if (r) return r;
    }

    // Check local declarations
    const body = containingFunc.childForFieldName('body');
    if (body) {
      const r = findLocalDeclaration(body, name, identifierNode);
      if (r) return r;
    }
  }

  // 4. Search top-level declarations
  return findTopLevelDeclaration(root, name);
}

// ─── Server Factory ──────────────────────────────────────────────────────────

/**
 * Creates a Go language server backed by the given VFS.
 *
 * Accepts optional `GoServerOptions` to override WASM file locations
 * (useful for testing outside a browser extension context).
 */
export async function createGoServer(
  vfs: VirtualFileSystem,
  options?: GoServerOptions,
): Promise<WasmServer> {
  let parser: Parser | null = null;
  const parsedTrees = new Map<string, Tree>();

  function parseAndCache(uri: string, content: string): Tree | null {
    if (!parser) return null;
    const old = parsedTrees.get(uri);
    if (old) old.delete();
    const tree = parser.parse(content);
    if (tree) parsedTrees.set(uri, tree);
    return tree;
  }

  function getTree(uri: string): Tree | null {
    const existing = parsedTrees.get(uri);
    if (existing) return existing;
    const file = vfs.getFile(uri);
    if (!file) return null;
    return parseAndCache(uri, file.content);
  }

  // ─── Request Handlers ────────────────────────────────────────────────

  function handleHover(
    params: TextDocumentPositionParams,
  ): {
    contents: { kind: string; value: string };
    range?: { start: Position; end: Position };
  } | null {
    const file = vfs.getFile(params.textDocument.uri);
    if (!file) return null;

    const tree = getTree(params.textDocument.uri);
    if (!tree) return null;

    const point = {
      row: params.position.line,
      column: params.position.character,
    };
    const node = tree.rootNode.namedDescendantForPosition(point);
    if (!node || !isIdentifierLike(node)) return null;

    // Try to resolve in the current file
    let declInfo = resolveIdentifier(tree.rootNode, node);

    // If not found locally, search other files in the VFS
    if (!declInfo) {
      for (const otherUri of vfs.listFiles()) {
        if (otherUri === params.textDocument.uri) continue;
        const otherTree = getTree(otherUri);
        if (!otherTree) continue;
        const topLevel = findTopLevelDeclaration(otherTree.rootNode, node.text);
        if (topLevel) {
          declInfo = topLevel;
          break;
        }
      }
    }

    if (!declInfo) return null;

    const hoverContent = declInfo.docComment
      ? `\`\`\`go\n${declInfo.signature}\n\`\`\`\n---\n${declInfo.docComment}`
      : `\`\`\`go\n${declInfo.signature}\n\`\`\``;

    return {
      contents: {
        kind: 'markdown',
        value: hoverContent,
      },
      range: {
        start: {
          line: node.startPosition.row,
          character: node.startPosition.column,
        },
        end: {
          line: node.endPosition.row,
          character: node.endPosition.column,
        },
      },
    };
  }

  function handleDefinition(
    params: TextDocumentPositionParams,
  ): { uri: string; range: { start: Position; end: Position } }[] {
    const file = vfs.getFile(params.textDocument.uri);
    if (!file) return [];

    const tree = getTree(params.textDocument.uri);
    if (!tree) return [];

    const point = {
      row: params.position.line,
      column: params.position.character,
    };
    const node = tree.rootNode.namedDescendantForPosition(point);
    if (!node || !isIdentifierLike(node)) return [];

    // Search current file first
    const declInfo = resolveIdentifier(tree.rootNode, node);
    if (declInfo) {
      // Find the name node within the declaration for precise location
      const nameNode = findDeclNameNode(declInfo.node, node.text) ?? declInfo.node;
      return [
        {
          uri: params.textDocument.uri,
          range: {
            start: {
              line: nameNode.startPosition.row,
              character: nameNode.startPosition.column,
            },
            end: {
              line: nameNode.endPosition.row,
              character: nameNode.endPosition.column,
            },
          },
        },
      ];
    }

    // Search other VFS files
    for (const otherUri of vfs.listFiles()) {
      if (otherUri === params.textDocument.uri) continue;
      const otherTree = getTree(otherUri);
      if (!otherTree) continue;
      const topLevel = findTopLevelDeclaration(otherTree.rootNode, node.text);
      if (topLevel) {
        const nameNode =
          findDeclNameNode(topLevel.node, node.text) ?? topLevel.node;
        return [
          {
            uri: otherUri,
            range: {
              start: {
                line: nameNode.startPosition.row,
                character: nameNode.startPosition.column,
              },
              end: {
                line: nameNode.endPosition.row,
                character: nameNode.endPosition.column,
              },
            },
          },
        ];
      }
    }

    return [];
  }

  /**
   * Find the identifier/name child node inside a declaration node.
   * Used for precise go-to-definition targeting.
   */
  function findDeclNameNode(
    declNode: SyntaxNode,
    name: string,
  ): SyntaxNode | null {
    // Try the 'name' field first (works for function_declaration,
    // method_declaration, type_spec, etc.)
    const nameField = declNode.childForFieldName('name');
    if (nameField && nameField.text === name) return nameField;

    // For var_spec/const_spec with multiple names, find the matching one
    const names = declNode.childrenForFieldName('name');
    for (const n of names) {
      if (n.text === name) return n;
    }

    // For short_var_declaration, search the left expression list
    const left = declNode.childForFieldName('left');
    if (left) {
      if (left.type === 'identifier' && left.text === name) return left;
      for (const child of left.namedChildren) {
        if (child.type === 'identifier' && child.text === name) return child;
      }
    }

    // For field_declaration, search field_identifier children
    for (const child of declNode.namedChildren) {
      if (child.type === 'field_identifier' && child.text === name) {
        return child;
      }
    }

    // For parameter_declaration, search identifier children
    for (const child of declNode.namedChildren) {
      if (child.type === 'identifier' && child.text === name) return child;
    }

    return null;
  }

  // ─── WasmServer Interface ────────────────────────────────────────────

  return {
    async initialize() {
      await Parser.init();
      parser = new Parser();

      const grammarUrl =
        options?.goGrammarWasmUrl ??
        // In a Chrome extension Web Worker, construct URL from worker location
        (typeof self !== 'undefined' &&
        typeof (self as { chrome?: { runtime?: unknown } }).chrome?.runtime !==
          'undefined'
          ? (
              self as unknown as {
                chrome: { runtime: { getURL: (p: string) => string } };
              }
            ).chrome.runtime.getURL('lsp/wasm/tree-sitter-go.wasm')
          : 'tree-sitter-go.wasm');

      const Go = await Language.load(grammarUrl);
      parser.setLanguage(Go);

      return {
        capabilities: {
          hoverProvider: true,
          definitionProvider: true,
          signatureHelpProvider: false,
        },
      };
    },

    async handleRequest(method: string, params: unknown) {
      if (!parser) return null;

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
          // Pre-parse the file so later requests are fast
          parseAndCache(p.textDocument.uri, p.textDocument.text);
          break;
        }
      }
    },

    async shutdown() {
      for (const tree of parsedTrees.values()) {
        tree.delete();
      }
      parsedTrees.clear();
      if (parser) {
        parser.delete();
        parser = null;
      }
    },
  };
}
