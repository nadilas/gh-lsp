/**
 * Elixir code parsing & analysis engine.
 *
 * Uses regex-based line-by-line parsing to extract structural information
 * from Elixir source code: modules, functions, types, docs, and directives.
 * This provides enough information for hover, go-to-definition, and
 * signature help without requiring a full AST parser or WASM dependency.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ElixirRange {
  startLine: number;
  endLine: number;
}

export interface ElixirFunction {
  name: string;
  arity: number;
  params: string[];
  spec: string | null;
  doc: string | null;
  visibility: 'public' | 'private';
  kind: 'def' | 'defp' | 'defmacro' | 'defmacrop' | 'defguard' | 'defdelegate';
  range: ElixirRange;
  guardClause: string | null;
}

export interface ElixirType {
  name: string;
  definition: string;
  doc: string | null;
  visibility: 'public' | 'private' | 'opaque';
  line: number;
}

export interface ElixirCallback {
  name: string;
  spec: string;
  line: number;
}

export interface ElixirDirective {
  kind: 'alias' | 'import' | 'use' | 'require';
  module: string;
  line: number;
}

export interface ElixirModule {
  name: string;
  doc: string | null;
  functions: ElixirFunction[];
  types: ElixirType[];
  callbacks: ElixirCallback[];
  directives: ElixirDirective[];
  range: ElixirRange;
}

export interface ElixirAnalysis {
  modules: ElixirModule[];
  topLevelDirectives: ElixirDirective[];
}

export interface HoverInfo {
  contents: { kind: string; value: string };
  range?: { start: { line: number; character: number }; end: { line: number; character: number } };
}

export interface DefinitionLocation {
  uri: string;
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
}

export interface SignatureHelp {
  signatures: Array<{
    label: string;
    documentation?: { kind: string; value: string };
    parameters?: Array<{
      label: string;
      documentation?: { kind: string; value: string };
    }>;
  }>;
  activeSignature?: number;
  activeParameter?: number;
}

// ─── Main Analysis Entry Point ────────────────────────────────────────────────

/**
 * Analyzes Elixir source code and extracts structural information.
 */
export function analyzeElixirSource(content: string): ElixirAnalysis {
  const lines = content.split('\n');
  const modules: ElixirModule[] = [];
  const topLevelDirectives: ElixirDirective[] = [];
  const moduleStack: ElixirModule[] = [];

  // Track pending doc/spec that will attach to the next function
  let pendingDoc: string | null = null;
  let pendingSpec: string | null = null;
  let pendingModuleDoc: string | null = null;
  let pendingTypeDoc: string | null = null;

  // Track nesting depth for matching end keywords
  let nestingStack: Array<{ kind: string; module?: ElixirModule }> = [];
  let inHeredoc = false;
  let heredocAttr: string | null = null;
  let heredocContent: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();

    // Handle heredoc collection
    if (inHeredoc) {
      if (/^\s*"""/.test(line) || /^\s*'''/.test(line)) {
        const collectedContent = heredocContent.join('\n');
        if (heredocAttr === '@moduledoc') {
          // Apply directly to current module on stack
          const currentModule = moduleStack[moduleStack.length - 1];
          if (currentModule) {
            currentModule.doc = collectedContent;
          } else {
            pendingModuleDoc = collectedContent;
          }
        } else if (heredocAttr === '@doc') {
          pendingDoc = collectedContent;
        } else if (heredocAttr === '@typedoc') {
          pendingTypeDoc = collectedContent;
        }
        inHeredoc = false;
        heredocAttr = null;
        heredocContent = [];
        i++;
        continue;
      }
      heredocContent.push(line);
      i++;
      continue;
    }

    // Skip comments and empty lines
    if (trimmed === '' || trimmed.startsWith('#')) {
      i++;
      continue;
    }

    // Detect @moduledoc
    const moduledocHeredocMatch = trimmed.match(/^@moduledoc\s+"""/);
    if (moduledocHeredocMatch) {
      inHeredoc = true;
      heredocAttr = '@moduledoc';
      heredocContent = [];
      // Check if there's content on the same line after """
      const afterQuotes = trimmed.slice(trimmed.indexOf('"""') + 3);
      if (afterQuotes.trim()) {
        heredocContent.push(afterQuotes);
      }
      i++;
      continue;
    }
    const moduledocSingleMatch = trimmed.match(/^@moduledoc\s+"([^"]*)"/);
    if (moduledocSingleMatch) {
      const currentModule = moduleStack[moduleStack.length - 1];
      if (currentModule) {
        currentModule.doc = moduledocSingleMatch[1]!;
      } else {
        pendingModuleDoc = moduledocSingleMatch[1]!;
      }
      i++;
      continue;
    }
    if (trimmed === '@moduledoc false') {
      pendingModuleDoc = null;
      i++;
      continue;
    }

    // Detect @doc
    const docHeredocMatch = trimmed.match(/^@doc\s+"""/);
    if (docHeredocMatch) {
      inHeredoc = true;
      heredocAttr = '@doc';
      heredocContent = [];
      const afterQuotes = trimmed.slice(trimmed.indexOf('"""') + 3);
      if (afterQuotes.trim()) {
        heredocContent.push(afterQuotes);
      }
      i++;
      continue;
    }
    const docSingleMatch = trimmed.match(/^@doc\s+"([^"]*)"/);
    if (docSingleMatch) {
      pendingDoc = docSingleMatch[1]!;
      i++;
      continue;
    }
    if (trimmed === '@doc false') {
      pendingDoc = null;
      i++;
      continue;
    }

    // Detect @typedoc
    const typedocHeredocMatch = trimmed.match(/^@typedoc\s+"""/);
    if (typedocHeredocMatch) {
      inHeredoc = true;
      heredocAttr = '@typedoc';
      heredocContent = [];
      i++;
      continue;
    }
    const typedocSingleMatch = trimmed.match(/^@typedoc\s+"([^"]*)"/);
    if (typedocSingleMatch) {
      pendingTypeDoc = typedocSingleMatch[1]!;
      i++;
      continue;
    }

    // Detect @spec
    const specMatch = trimmed.match(/^@spec\s+(.+)/);
    if (specMatch) {
      pendingSpec = specMatch[1]!;
      i++;
      continue;
    }

    // Detect @callback
    const callbackMatch = trimmed.match(/^@callback\s+(\w+)(.+)/);
    if (callbackMatch) {
      const currentModule = moduleStack[moduleStack.length - 1];
      if (currentModule) {
        currentModule.callbacks.push({
          name: callbackMatch[1]!,
          spec: callbackMatch[2]!.trim(),
          line: i,
        });
      }
      i++;
      continue;
    }

    // Detect @type, @typep, @opaque
    const typeMatch = trimmed.match(/^@(type|typep|opaque)\s+(.+)/);
    if (typeMatch) {
      const typeKind = typeMatch[1]! as 'type' | 'typep' | 'opaque';
      const typeDef = typeMatch[2]!;
      const typeName = typeDef.match(/^(\w+)/)?.[1] ?? typeDef;

      const visibility: 'public' | 'private' | 'opaque' =
        typeKind === 'typep' ? 'private' :
        typeKind === 'opaque' ? 'opaque' : 'public';

      const currentModule = moduleStack[moduleStack.length - 1];
      if (currentModule) {
        currentModule.types.push({
          name: typeName,
          definition: `@${typeKind} ${typeDef}`,
          doc: pendingTypeDoc,
          visibility,
          line: i,
        });
      }
      pendingTypeDoc = null;
      i++;
      continue;
    }

    // Detect defmodule
    const moduleMatch = trimmed.match(/^defmodule\s+([\w.]+)\s+do/);
    if (moduleMatch) {
      const mod: ElixirModule = {
        name: moduleMatch[1]!,
        doc: pendingModuleDoc,
        functions: [],
        types: [],
        callbacks: [],
        directives: [],
        range: { startLine: i, endLine: i },
      };
      pendingModuleDoc = null;

      modules.push(mod);
      moduleStack.push(mod);
      nestingStack.push({ kind: 'defmodule', module: mod });
      i++;
      continue;
    }

    // Detect function definitions
    const funcMatch = trimmed.match(
      /^(def|defp|defmacro|defmacrop|defguard|defdelegate)\s+(\w+[!?]?)(\(([^)]*)\))?(.*)$/,
    );
    if (funcMatch) {
      const kind = funcMatch[1]! as ElixirFunction['kind'];
      let funcName = funcMatch[2]!;

      // Handle operators: defguard is_xxx, def unquote(...)
      // Keep function name clean
      if (funcName.endsWith('!') || funcName.endsWith('?')) {
        // name already includes ? or !
      }

      const paramsStr = funcMatch[4] ?? '';
      const rest = funcMatch[5] ?? '';
      const params = parseParams(paramsStr);
      const arity = params.length;

      const visibility: 'public' | 'private' =
        kind === 'defp' || kind === 'defmacrop' ? 'private' : 'public';

      // Check for guard clause
      let guardClause: string | null = null;
      const guardMatch = rest.match(/\bwhen\s+(.+?)(?:\bdo\b|$)/);
      if (guardMatch) {
        guardClause = guardMatch[1]!.trim();
      }

      // Determine if this is a single-line def or a multi-line block
      const hasDoBlock = /\bdo\b/.test(rest) && !/\bdo:/.test(rest);
      let endLine = i;

      if (hasDoBlock) {
        // Multi-line block — find the matching end
        nestingStack.push({ kind: 'def' });
        endLine = findMatchingEnd(lines, i + 1, nestingStack);
      }

      const func: ElixirFunction = {
        name: funcName,
        arity,
        params,
        spec: pendingSpec,
        doc: pendingDoc,
        visibility,
        kind,
        range: { startLine: i, endLine },
        guardClause,
      };

      pendingDoc = null;
      pendingSpec = null;

      const currentModule = moduleStack[moduleStack.length - 1];
      if (currentModule) {
        currentModule.functions.push(func);
      }

      if (hasDoBlock) {
        i = endLine + 1;
      } else {
        i++;
      }
      continue;
    }

    // Detect alias, import, use, require directives
    const directiveMatch = trimmed.match(/^(alias|import|use|require)\s+([\w.{},:\s]+)/);
    if (directiveMatch) {
      const kind = directiveMatch[1]! as ElixirDirective['kind'];
      const rawModule = directiveMatch[2]!.split(',')[0]!.trim();
      // Clean module name from trailing options/keywords
      const moduleName = rawModule.replace(/\s*,.*$/, '').replace(/\s*$/, '');

      const directive: ElixirDirective = {
        kind,
        module: moduleName,
        line: i,
      };

      const currentModule = moduleStack[moduleStack.length - 1];
      if (currentModule) {
        currentModule.directives.push(directive);
      } else {
        topLevelDirectives.push(directive);
      }
      i++;
      continue;
    }

    // Track nesting for end keywords
    if (/\b(do)\s*$/.test(trimmed) || /\bdo\s*$/.test(trimmed)) {
      // Some block opened — if it's a standalone block or another nesting structure
      if (!trimmed.startsWith('def') && !trimmed.startsWith('defmodule')) {
        nestingStack.push({ kind: 'block' });
      }
    }

    // Detect `end` keyword to close nesting
    if (trimmed === 'end') {
      const top = nestingStack[nestingStack.length - 1];
      if (top) {
        if (top.kind === 'defmodule' && top.module) {
          top.module.range.endLine = i;
          moduleStack.pop();
        }
        nestingStack.pop();
      }
    }

    i++;
  }

  return { modules, topLevelDirectives };
}

// ─── Parameter Parsing ────────────────────────────────────────────────────────

/**
 * Parses an Elixir function parameter string into individual parameter names.
 */
function parseParams(paramsStr: string): string[] {
  if (!paramsStr.trim()) return [];

  const params: string[] = [];
  let depth = 0;
  let current = '';

  for (const ch of paramsStr) {
    if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
      current += ch;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      current += ch;
    } else if (ch === ',' && depth === 0) {
      const param = extractParamName(current.trim());
      if (param) params.push(param);
      current = '';
    } else {
      current += ch;
    }
  }

  const last = extractParamName(current.trim());
  if (last) params.push(last);

  return params;
}

/**
 * Extracts the parameter name from a parameter expression.
 * Handles patterns like `name`, `name \\\\ default`, `%{} = name`, etc.
 */
function extractParamName(param: string): string | null {
  if (!param) return null;

  // Handle default values: name \\ default
  const defaultMatch = param.match(/^(\w+)\s*\\\\/);
  if (defaultMatch) return defaultMatch[1]!;

  // Handle pattern match: _pattern = name or %{} = name
  const assignMatch = param.match(/=\s*(\w+)\s*$/);
  if (assignMatch && !param.startsWith(assignMatch[1]!)) return assignMatch[1]!;

  // Handle simple names, possibly with type annotations
  const nameMatch = param.match(/^(\w+)/);
  if (nameMatch) return nameMatch[1]!;

  // Complex patterns — return the whole thing
  return param;
}

// ─── End-matching ──────────────────────────────────────────────────────────────

/**
 * Finds the matching `end` for a block starting at the given line.
 * Accounts for nested blocks.
 */
function findMatchingEnd(
  lines: string[],
  startLine: number,
  nestingStack: Array<{ kind: string; module?: ElixirModule }>,
): number {
  const targetDepth = nestingStack.length - 1;

  for (let i = startLine; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();

    if (trimmed.startsWith('#') || trimmed === '') continue;

    // Count opening blocks
    if (
      /\bdo\s*$/.test(trimmed) ||
      /\bdo\s*#/.test(trimmed) ||
      /^(fn\b.+->)/.test(trimmed) && !trimmed.includes('end')
    ) {
      nestingStack.push({ kind: 'nested' });
    }

    if (trimmed === 'end' || /^\s*end\s*$/.test(lines[i]!)) {
      if (nestingStack.length - 1 === targetDepth) {
        nestingStack.pop();
        return i;
      }
      nestingStack.pop();
    }
  }

  return lines.length - 1;
}

// ─── Hover Info ───────────────────────────────────────────────────────────────

/**
 * Returns hover information for the symbol at the given position.
 */
export function getHoverInfoAt(
  analysis: ElixirAnalysis,
  content: string,
  line: number,
  character: number,
): HoverInfo | null {
  const lines = content.split('\n');
  if (line >= lines.length) return null;

  const lineText = lines[line]!;
  const word = getWordAt(lineText, character);
  if (!word) return null;

  // Check if it's a module name (starts with uppercase or contains dots)
  const fullQualified = getQualifiedNameAt(lineText, character);

  // Try to find as module
  if (fullQualified) {
    for (const mod of analysis.modules) {
      if (mod.name === fullQualified || mod.name.endsWith(`.${fullQualified}`)) {
        return buildModuleHover(mod, line, lineText, fullQualified);
      }
    }
  }

  // Try to find as function within modules
  for (const mod of analysis.modules) {
    // Check if cursor is on a function definition or call
    for (const func of mod.functions) {
      if (func.name === word.text) {
        return buildFunctionHover(func, mod, line, lineText, word);
      }
    }

    // Check types
    for (const type of mod.types) {
      if (type.name === word.text) {
        return buildTypeHover(type, mod, line, lineText, word);
      }
    }
  }

  // Check for qualified function call like Module.func
  if (fullQualified && fullQualified.includes('.')) {
    const parts = fullQualified.split('.');
    const funcName = parts.pop()!;
    const modName = parts.join('.');

    for (const mod of analysis.modules) {
      if (mod.name === modName || mod.name.endsWith(`.${modName}`)) {
        for (const func of mod.functions) {
          if (func.name === funcName) {
            return buildFunctionHover(func, mod, line, lineText, word);
          }
        }
      }
    }
  }

  return null;
}

function buildModuleHover(
  mod: ElixirModule,
  line: number,
  lineText: string,
  name: string,
): HoverInfo {
  let value = `\`\`\`elixir\ndefmodule ${mod.name}\n\`\`\``;
  if (mod.doc) {
    value += `\n---\n${mod.doc}`;
  }

  const startChar = lineText.indexOf(name);
  return {
    contents: { kind: 'markdown', value },
    range: startChar >= 0 ? {
      start: { line, character: startChar },
      end: { line, character: startChar + name.length },
    } : undefined,
  };
}

function buildFunctionHover(
  func: ElixirFunction,
  _mod: ElixirModule,
  line: number,
  _lineText: string,
  word: { text: string; start: number; end: number },
): HoverInfo {
  let signature: string;
  if (func.spec) {
    signature = `@spec ${func.spec}\n${func.kind} ${func.name}(${func.params.join(', ')})`;
  } else {
    signature = `${func.kind} ${func.name}(${func.params.join(', ')})`;
  }

  let value = `\`\`\`elixir\n${signature}\n\`\`\``;
  if (func.doc) {
    value += `\n---\n${func.doc}`;
  }

  return {
    contents: { kind: 'markdown', value },
    range: {
      start: { line, character: word.start },
      end: { line, character: word.end },
    },
  };
}

function buildTypeHover(
  type: ElixirType,
  _mod: ElixirModule,
  line: number,
  _lineText: string,
  word: { text: string; start: number; end: number },
): HoverInfo {
  let value = `\`\`\`elixir\n${type.definition}\n\`\`\``;
  if (type.doc) {
    value += `\n---\n${type.doc}`;
  }

  return {
    contents: { kind: 'markdown', value },
    range: {
      start: { line, character: word.start },
      end: { line, character: word.end },
    },
  };
}

// ─── Go-to-Definition ─────────────────────────────────────────────────────────

/**
 * Finds the definition location of the symbol at the given position.
 * Searches across all provided analyses (multi-file support).
 */
export function findDefinitionAt(
  analyses: Map<string, ElixirAnalysis>,
  _uri: string,
  content: string,
  line: number,
  character: number,
): DefinitionLocation[] {
  const lines = content.split('\n');
  if (line >= lines.length) return [];

  const lineText = lines[line]!;
  const word = getWordAt(lineText, character);
  if (!word) return [];

  const fullQualified = getQualifiedNameAt(lineText, character);
  const results: DefinitionLocation[] = [];

  // If qualified name like Module.func, split it
  if (fullQualified && fullQualified.includes('.')) {
    const parts = fullQualified.split('.');
    const funcName = parts.pop()!;
    const modName = parts.join('.');

    for (const [fileUri, analysis] of analyses) {
      for (const mod of analysis.modules) {
        if (mod.name === modName || mod.name.endsWith(`.${modName}`)) {
          // Look for function in module
          for (const func of mod.functions) {
            if (func.name === funcName) {
              results.push({
                uri: fileUri,
                range: {
                  start: { line: func.range.startLine, character: 0 },
                  end: { line: func.range.startLine, character: 0 },
                },
              });
            }
          }
        }
      }
    }
    if (results.length > 0) return results;
  }

  // Try as module name
  if (fullQualified && /^[A-Z]/.test(fullQualified)) {
    for (const [fileUri, analysis] of analyses) {
      for (const mod of analysis.modules) {
        if (mod.name === fullQualified || mod.name.endsWith(`.${fullQualified}`)) {
          results.push({
            uri: fileUri,
            range: {
              start: { line: mod.range.startLine, character: 0 },
              end: { line: mod.range.startLine, character: 0 },
            },
          });
        }
      }
    }
    if (results.length > 0) return results;
  }

  // Try as function name (unqualified)
  for (const [fileUri, analysis] of analyses) {
    for (const mod of analysis.modules) {
      for (const func of mod.functions) {
        if (func.name === word.text) {
          results.push({
            uri: fileUri,
            range: {
              start: { line: func.range.startLine, character: 0 },
              end: { line: func.range.startLine, character: 0 },
            },
          });
        }
      }
    }
  }

  return results;
}

// ─── Signature Help ──────────────────────────────────────────────────────────

/**
 * Returns signature help for the function call at the given position.
 */
export function getSignatureHelpAt(
  analysis: ElixirAnalysis,
  content: string,
  line: number,
  character: number,
): SignatureHelp | null {
  const lines = content.split('\n');
  if (line >= lines.length) return null;

  const lineText = lines[line]!;
  const callInfo = findFunctionCallAt(lineText, character);
  if (!callInfo) return null;

  const { funcName, activeParameter } = callInfo;

  // Search for the function in all modules
  for (const mod of analysis.modules) {
    for (const func of mod.functions) {
      if (func.name === funcName) {
        return buildSignatureHelp(func, activeParameter);
      }
    }
  }

  // Try qualified calls: extract module and function name
  if (funcName.includes('.')) {
    const parts = funcName.split('.');
    const fName = parts.pop()!;
    const modName = parts.join('.');

    for (const mod of analysis.modules) {
      if (mod.name === modName || mod.name.endsWith(`.${modName}`)) {
        for (const func of mod.functions) {
          if (func.name === fName) {
            return buildSignatureHelp(func, activeParameter);
          }
        }
      }
    }
  }

  return null;
}

function buildSignatureHelp(func: ElixirFunction, activeParameter: number): SignatureHelp {
  let label: string;
  if (func.spec) {
    label = `${func.name}(${func.params.join(', ')})`;
  } else {
    label = `${func.name}(${func.params.join(', ')})`;
  }

  const parameters = func.params.map((param) => ({
    label: param,
  }));

  const signature: SignatureHelp['signatures'][0] = {
    label,
    parameters,
  };

  if (func.doc) {
    signature.documentation = {
      kind: 'markdown',
      value: func.doc,
    };
  }

  return {
    signatures: [signature],
    activeSignature: 0,
    activeParameter: Math.min(activeParameter, func.params.length - 1),
  };
}

/**
 * Detects if the cursor is inside a function call and identifies
 * the function name and active parameter index.
 */
function findFunctionCallAt(
  lineText: string,
  character: number,
): { funcName: string; activeParameter: number } | null {
  // Look backwards from cursor to find the opening paren
  const before = lineText.slice(0, character);

  let parenDepth = 0;
  let openParenPos = -1;

  for (let i = before.length - 1; i >= 0; i--) {
    const ch = before[i]!;
    if (ch === ')') {
      parenDepth++;
    } else if (ch === '(') {
      if (parenDepth === 0) {
        openParenPos = i;
        break;
      }
      parenDepth--;
    }
  }

  if (openParenPos < 0) return null;

  // Extract function name before the opening paren
  const beforeParen = before.slice(0, openParenPos).trimEnd();
  const funcNameMatch = beforeParen.match(/([\w.!?]+)\s*$/);
  if (!funcNameMatch) return null;

  const funcName = funcNameMatch[1]!;

  // Count commas between openParenPos and cursor to find active parameter
  const insideParens = before.slice(openParenPos + 1);
  let activeParameter = 0;
  let depth = 0;

  for (const ch of insideParens) {
    if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
    } else if (ch === ',' && depth === 0) {
      activeParameter++;
    }
  }

  return { funcName, activeParameter };
}

// ─── Word Extraction Utilities ───────────────────────────────────────────────

/**
 * Gets the word (identifier) at the given character position in a line.
 */
function getWordAt(
  lineText: string,
  character: number,
): { text: string; start: number; end: number } | null {
  if (character > lineText.length) return null;

  // Find word boundaries
  let start = character;
  let end = character;

  // Expand left
  while (start > 0 && isIdentChar(lineText[start - 1]!)) {
    start--;
  }

  // Expand right
  while (end < lineText.length && isIdentChar(lineText[end]!)) {
    end++;
  }

  if (start === end) return null;

  return {
    text: lineText.slice(start, end),
    start,
    end,
  };
}

/**
 * Gets a fully-qualified name (with dots) at the given position.
 * E.g., `MyApp.Accounts.User` or `Enum.map`.
 */
function getQualifiedNameAt(lineText: string, character: number): string | null {
  if (character > lineText.length) return null;

  let start = character;
  let end = character;

  // Expand left (include dots for qualified names)
  while (start > 0 && (isIdentChar(lineText[start - 1]!) || lineText[start - 1] === '.')) {
    start--;
  }

  // Expand right
  while (end < lineText.length && (isIdentChar(lineText[end]!) || lineText[end] === '.')) {
    end++;
  }

  if (start === end) return null;

  const name = lineText.slice(start, end);
  // Remove trailing dots
  return name.replace(/\.+$/, '') || null;
}

function isIdentChar(ch: string): boolean {
  return /[\w!?]/.test(ch);
}
