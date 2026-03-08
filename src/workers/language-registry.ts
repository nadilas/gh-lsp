import type { SupportedLanguage, LspServerCapabilities } from '../shared/types';
import type { VirtualFileSystem } from './vfs';

/**
 * Interface that all WASM-based language servers must implement.
 * Provides the LSP lifecycle and request/notification handling.
 */
export interface WasmServer {
  initialize(params: unknown): Promise<unknown>;
  handleRequest(method: string, params: unknown): Promise<unknown>;
  handleNotification(method: string, params: unknown): void;
  shutdown(): Promise<void>;
}

/**
 * Factory function type for creating language-specific WASM servers.
 */
export type WasmServerFactory = (vfs: VirtualFileSystem) => Promise<WasmServer>;

/**
 * Per-language capability declarations.
 * Determines which LSP methods each language server supports.
 */
const CAPABILITIES: Record<SupportedLanguage, LspServerCapabilities> = {
  typescript: {
    hoverProvider: true,
    definitionProvider: true,
    signatureHelpProvider: true,
  },
  javascript: {
    hoverProvider: true,
    definitionProvider: true,
    signatureHelpProvider: true,
  },
  go: {
    hoverProvider: true,
    definitionProvider: true,
    signatureHelpProvider: false,
  },
  rust: {
    hoverProvider: true,
    definitionProvider: true,
    signatureHelpProvider: false,
  },
  python: {
    hoverProvider: true,
    definitionProvider: true,
    signatureHelpProvider: true,
  },
};

/**
 * Returns the declared capabilities for a given language.
 */
export function getCapabilities(
  language: SupportedLanguage,
): LspServerCapabilities {
  return CAPABILITIES[language];
}

/**
 * Registry of language server factories. Each language's loader module
 * registers itself here. This allows lazy loading of language servers.
 */
const serverFactories: Map<SupportedLanguage, WasmServerFactory> = new Map();

/**
 * Registers a factory function for creating a WASM server for a language.
 */
export function registerServerFactory(
  language: SupportedLanguage,
  factory: WasmServerFactory,
): void {
  serverFactories.set(language, factory);
}

/**
 * Loads and initializes a WASM language server for the given language.
 *
 * Looks up the registered factory, calls it to create the server instance,
 * and returns it. Throws if no factory is registered for the language.
 */
export async function loadWasmServer(
  language: SupportedLanguage,
  vfs: VirtualFileSystem,
): Promise<WasmServer> {
  const factory = serverFactories.get(language);
  if (!factory) {
    throw new Error(
      `No WASM server factory registered for language: ${language}`,
    );
  }

  return factory(vfs);
}

/**
 * Checks if a WASM server factory is registered for the given language.
 */
export function hasServerFactory(language: SupportedLanguage): boolean {
  return serverFactories.has(language);
}
