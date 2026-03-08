# Phase 4: WASM Language Server Integration — Task Details

## Prerequisites
- P3-T1 (JSON-RPC Transport) complete
- P3-T2 (Virtual File System) complete
- P3-T3 (Language Registry) complete

## Tasks

### P4-T1: TypeScript WASM Server — Research & Sourcing

**Purpose**: Obtain or build a TypeScript language server that can run as WASM in a Web Worker.

**Research directions**:

1. **Existing WASM builds**:
   - `@aspect-build/aspect-typescript-worker` — pre-compiled TS server for browsers
   - `typescript-wasm` — unofficial WASM build of the TypeScript compiler
   - VS Code's built-in TypeScript worker (may be extractable)

2. **Custom build from tsserver**:
   - Compile `typescript/lib/tsserver.js` using `esbuild` → single bundle → wrap for Web Worker
   - TypeScript's `tsserver` is pure JS, so no WASM compilation needed — just needs a VFS adapter
   - This is the most reliable approach: bundle tsserver + inject VFS shim

3. **Minimal hover-only analyzer**:
   - For MVP, build a lightweight type analyzer using TypeScript's compiler API
   - `ts.createLanguageService()` with a `LanguageServiceHost` backed by VFS
   - Supports hover, definition, signature help via standard TS API
   - Much smaller bundle than full tsserver

**Recommended approach**: Option 3 (minimal analyzer using `ts.createLanguageService`) for MVP, with option to upgrade to full tsserver later.

**Output**: Decision document at `openspec/decisions/wasm-ts-server.md`

**Acceptance criteria**:
- Decision documented with rationale
- Working proof-of-concept that loads in a Web Worker
- Can process a simple `textDocument/hover` request

---

### P4-T2: WASM Loader for TypeScript

**Purpose**: Production-quality loader that initializes the TypeScript server, configures capabilities, and handles requests.

**Implementation guide**:

```typescript
// src/lsp/typescript-loader.ts

import type { WasmServer } from '@workers/language-registry';
import type { VirtualFileSystem } from '@workers/vfs';

export function createTypeScriptServer(vfs: VirtualFileSystem): WasmServer {
  // Option 3 approach:
  // 1. Import typescript compiler (bundled)
  // 2. Create LanguageServiceHost backed by VFS
  // 3. Create LanguageService
  // 4. Map LSP methods to TS compiler API:
  //    - textDocument/hover → languageService.getQuickInfoAtPosition()
  //    - textDocument/definition → languageService.getDefinitionAtPosition()
  //    - textDocument/signatureHelp → languageService.getSignatureHelpItems()
  // 5. Convert TS results to LSP response format
}
```

**Key mappings**:
| LSP Method | TypeScript API | Response Mapping |
|---|---|---|
| `textDocument/hover` | `getQuickInfoAtPosition(file, pos)` | `displayParts` → markdown, `documentation` → docstring |
| `textDocument/definition` | `getDefinitionAtPosition(file, pos)` | `fileName` + `textSpan` → `Location` |
| `textDocument/signatureHelp` | `getSignatureHelpItems(file, pos)` | `items` → `SignatureInformation[]` |

**Tests required**:
- Hover on a typed variable returns type info
- Hover on a function returns signature + JSDoc
- Definition resolves to correct file and position
- Hover on whitespace returns null
- Server handles unknown files gracefully

---

### P4-T3: Additional WASM Servers (Go, Rust, Python)

**Purpose**: Extend language support beyond TypeScript/JavaScript.

**Research per language**:

**Go**:
- `gopls` is written in Go — can be compiled to WASM via `GOOS=js GOARCH=wasm go build`
- However, gopls has large dependency tree and may produce very large WASM (~50MB+)
- Alternative: tree-sitter-go for basic hover + type annotations parsing
- Recommended: Defer to post-MVP unless a lightweight Go analyzer exists

**Rust**:
- `rust-analyzer` is written in Rust — can be compiled to WASM via `wasm-pack`
- Large binary but feasible
- Alternative: `tree-sitter-rust` for basic analysis
- Recommended: Investigate `rust-analyzer` WASM build feasibility

**Python**:
- `pyright` is written in TypeScript — can run in browser with VFS adapter (similar to TS approach)
- `pylsp` is Python — cannot easily compile to WASM
- Recommended: Bundle Pyright (TypeScript-based) similar to the TS server approach

**Acceptance criteria**:
- At least one additional language server produces correct hover responses
- Integration tests pass for each working server
- Decision documents for each language in `openspec/decisions/`

---

## Parallelization Notes

- P4-T1 is a research task that blocks P4-T2
- P4-T3 can start research in parallel with P4-T2 implementation
- Each language in P4-T3 is independent and can be parallelized
