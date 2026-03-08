import type { SupportedLanguage, FileExtensionMap } from './types';

const FILE_EXTENSION_MAP: FileExtensionMap = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.go': 'go',
  '.rs': 'rust',
  '.py': 'python',
  '.pyi': 'python',
};

const SUPPORTED_LANGUAGES: ReadonlySet<string> = new Set<SupportedLanguage>([
  'typescript',
  'javascript',
  'go',
  'rust',
  'python',
]);

/**
 * Maps a file extension (including the leading dot) to a supported language.
 * Returns null for unknown extensions.
 */
export function getLanguageForExtension(
  ext: string,
): SupportedLanguage | null {
  return FILE_EXTENSION_MAP[ext.toLowerCase()] ?? null;
}

/**
 * Extracts the file extension from a path and maps it to a supported language.
 * Handles paths like "src/index.ts", "main.go", ".gitignore" (unsupported).
 */
export function getLanguageForFilePath(
  filePath: string,
): SupportedLanguage | null {
  const lastDot = filePath.lastIndexOf('.');
  if (lastDot <= 0 && !filePath.startsWith('.')) {
    return null;
  }
  if (lastDot < 0) {
    return null;
  }
  const ext = filePath.slice(lastDot).toLowerCase();
  return getLanguageForExtension(ext);
}

/**
 * Returns the WASM binary path for a given supported language.
 */
export function getWasmPath(language: SupportedLanguage): string {
  return `lsp/wasm/${language}-server.wasm`;
}

/**
 * Type guard: checks if a string is a supported language ID.
 */
export function isSupportedLanguage(lang: string): lang is SupportedLanguage {
  return SUPPORTED_LANGUAGES.has(lang);
}
