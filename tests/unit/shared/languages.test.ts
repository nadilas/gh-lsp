import { describe, it, expect } from 'vitest';
import {
  getLanguageForExtension,
  getLanguageForFilePath,
  getWasmPath,
  isSupportedLanguage,
} from '../../../src/shared/languages';

describe('getLanguageForExtension', () => {
  it('maps TypeScript extensions', () => {
    expect(getLanguageForExtension('.ts')).toBe('typescript');
    expect(getLanguageForExtension('.tsx')).toBe('typescript');
  });

  it('maps JavaScript extensions', () => {
    expect(getLanguageForExtension('.js')).toBe('javascript');
    expect(getLanguageForExtension('.jsx')).toBe('javascript');
    expect(getLanguageForExtension('.mjs')).toBe('javascript');
    expect(getLanguageForExtension('.cjs')).toBe('javascript');
  });

  it('maps Go extension', () => {
    expect(getLanguageForExtension('.go')).toBe('go');
  });

  it('maps Rust extension', () => {
    expect(getLanguageForExtension('.rs')).toBe('rust');
  });

  it('maps Python extensions', () => {
    expect(getLanguageForExtension('.py')).toBe('python');
    expect(getLanguageForExtension('.pyi')).toBe('python');
  });

  it('returns null for unknown extensions', () => {
    expect(getLanguageForExtension('.java')).toBeNull();
    expect(getLanguageForExtension('.rb')).toBeNull();
    expect(getLanguageForExtension('.cpp')).toBeNull();
    expect(getLanguageForExtension('.html')).toBeNull();
    expect(getLanguageForExtension('.css')).toBeNull();
    expect(getLanguageForExtension('.md')).toBeNull();
    expect(getLanguageForExtension('')).toBeNull();
  });

  it('handles case-insensitive matching', () => {
    expect(getLanguageForExtension('.TS')).toBe('typescript');
    expect(getLanguageForExtension('.Tsx')).toBe('typescript');
    expect(getLanguageForExtension('.JS')).toBe('javascript');
    expect(getLanguageForExtension('.Go')).toBe('go');
    expect(getLanguageForExtension('.RS')).toBe('rust');
    expect(getLanguageForExtension('.PY')).toBe('python');
  });
});

describe('getLanguageForFilePath', () => {
  it('extracts language from simple file paths', () => {
    expect(getLanguageForFilePath('index.ts')).toBe('typescript');
    expect(getLanguageForFilePath('main.go')).toBe('go');
    expect(getLanguageForFilePath('lib.rs')).toBe('rust');
    expect(getLanguageForFilePath('app.py')).toBe('python');
  });

  it('extracts language from nested paths', () => {
    expect(getLanguageForFilePath('src/components/App.tsx')).toBe('typescript');
    expect(getLanguageForFilePath('pkg/handler/main.go')).toBe('go');
    expect(getLanguageForFilePath('src/lib.rs')).toBe('rust');
    expect(getLanguageForFilePath('tests/test_main.py')).toBe('python');
  });

  it('handles paths with multiple dots', () => {
    expect(getLanguageForFilePath('vite.config.ts')).toBe('typescript');
    expect(getLanguageForFilePath('src/index.test.tsx')).toBe('typescript');
    expect(getLanguageForFilePath('utils.spec.js')).toBe('javascript');
  });

  it('returns null for paths without extensions', () => {
    expect(getLanguageForFilePath('Makefile')).toBeNull();
    expect(getLanguageForFilePath('Dockerfile')).toBeNull();
  });

  it('returns null for dotfiles without known extensions', () => {
    expect(getLanguageForFilePath('.gitignore')).toBeNull();
    expect(getLanguageForFilePath('.eslintrc')).toBeNull();
  });

  it('returns null for unsupported extensions', () => {
    expect(getLanguageForFilePath('README.md')).toBeNull();
    expect(getLanguageForFilePath('styles.css')).toBeNull();
    expect(getLanguageForFilePath('index.html')).toBeNull();
  });

  it('handles .pyi stub files', () => {
    expect(getLanguageForFilePath('numpy/__init__.pyi')).toBe('python');
  });

  it('handles ESM/CJS module files', () => {
    expect(getLanguageForFilePath('config.mjs')).toBe('javascript');
    expect(getLanguageForFilePath('require.cjs')).toBe('javascript');
  });
});

describe('getWasmPath', () => {
  it('returns correct WASM path for each language', () => {
    expect(getWasmPath('typescript')).toBe('lsp/wasm/typescript-server.wasm');
    expect(getWasmPath('javascript')).toBe('lsp/wasm/javascript-server.wasm');
    expect(getWasmPath('go')).toBe('lsp/wasm/go-server.wasm');
    expect(getWasmPath('rust')).toBe('lsp/wasm/rust-server.wasm');
    expect(getWasmPath('python')).toBe('lsp/wasm/python-server.wasm');
  });
});

describe('isSupportedLanguage', () => {
  it('returns true for all supported languages', () => {
    expect(isSupportedLanguage('typescript')).toBe(true);
    expect(isSupportedLanguage('javascript')).toBe(true);
    expect(isSupportedLanguage('go')).toBe(true);
    expect(isSupportedLanguage('rust')).toBe(true);
    expect(isSupportedLanguage('python')).toBe(true);
  });

  it('returns false for unsupported languages', () => {
    expect(isSupportedLanguage('java')).toBe(false);
    expect(isSupportedLanguage('ruby')).toBe(false);
    expect(isSupportedLanguage('c')).toBe(false);
    expect(isSupportedLanguage('cpp')).toBe(false);
    expect(isSupportedLanguage('')).toBe(false);
    expect(isSupportedLanguage('TypeScript')).toBe(false); // case-sensitive
  });
});
