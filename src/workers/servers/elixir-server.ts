/**
 * Elixir language server adapter.
 *
 * Uses a custom regex-based Elixir code analyzer to provide hover,
 * go-to-definition, and signature help. No WASM compilation required —
 * the analyzer runs directly in the Web Worker as TypeScript.
 *
 * The adapter translates LSP methods to Elixir analyzer calls:
 *   textDocument/hover         → getHoverInfoAt
 *   textDocument/definition    → findDefinitionAt
 *   textDocument/signatureHelp → getSignatureHelpAt
 */

import type { WasmServer } from '../language-registry';
import type { VirtualFileSystem } from '../vfs';
import {
  analyzeElixirSource,
  getHoverInfoAt,
  findDefinitionAt,
  getSignatureHelpAt,
} from './elixir-analyzer';
import type { ElixirAnalysis } from './elixir-analyzer';

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

// ─── Analysis Cache ──────────────────────────────────────────────────────────

interface CachedAnalysis {
  analysis: ElixirAnalysis;
  version: number;
}

// ─── Server Factory ──────────────────────────────────────────────────────────

export async function createElixirServer(vfs: VirtualFileSystem): Promise<WasmServer> {
  let initialized = false;
  const analysisCache = new Map<string, CachedAnalysis>();

  function getAnalysis(uri: string): ElixirAnalysis | null {
    const file = vfs.getFile(uri);
    if (!file) return null;

    const cached = analysisCache.get(uri);
    if (cached && cached.version === file.version) {
      return cached.analysis;
    }

    const analysis = analyzeElixirSource(file.content);
    analysisCache.set(uri, { analysis, version: file.version });
    return analysis;
  }

  function getAllAnalyses(): Map<string, ElixirAnalysis> {
    const all = new Map<string, ElixirAnalysis>();
    for (const uri of vfs.listFiles()) {
      const analysis = getAnalysis(uri);
      if (analysis) {
        all.set(uri, analysis);
      }
    }
    return all;
  }

  return {
    async initialize() {
      initialized = true;
      return {
        capabilities: {
          hoverProvider: true,
          definitionProvider: true,
          signatureHelpProvider: true,
        },
      };
    },

    async handleRequest(method: string, params: unknown) {
      if (!initialized) return null;

      switch (method) {
        case 'textDocument/hover': {
          const p = params as TextDocumentPositionParams;
          const file = vfs.getFile(p.textDocument.uri);
          if (!file) return null;

          const analysis = getAnalysis(p.textDocument.uri);
          if (!analysis) return null;

          return getHoverInfoAt(
            analysis,
            file.content,
            p.position.line,
            p.position.character,
          );
        }

        case 'textDocument/definition': {
          const p = params as TextDocumentPositionParams;
          const file = vfs.getFile(p.textDocument.uri);
          if (!file) return null;

          const analyses = getAllAnalyses();
          return findDefinitionAt(
            analyses,
            p.textDocument.uri,
            file.content,
            p.position.line,
            p.position.character,
          );
        }

        case 'textDocument/signatureHelp': {
          const p = params as TextDocumentPositionParams;
          const file = vfs.getFile(p.textDocument.uri);
          if (!file) return null;

          const analysis = getAnalysis(p.textDocument.uri);
          if (!analysis) return null;

          return getSignatureHelpAt(
            analysis,
            file.content,
            p.position.line,
            p.position.character,
          );
        }

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
          // Pre-analyze the file on open
          getAnalysis(p.textDocument.uri);
          break;
        }
      }
    },

    async shutdown() {
      analysisCache.clear();
      initialized = false;
    },
  };
}
