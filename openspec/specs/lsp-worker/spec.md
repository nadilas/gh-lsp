# LSP Worker — Specification

## Overview

LSP Workers are Web Workers that each run a single WASM-compiled language server. They implement the LSP client-server protocol over `postMessage`-based JSON-RPC 2.0, providing language intelligence capabilities (hover, go-to-definition, signature help) for a specific programming language.

---

## Requirement: Worker Lifecycle

Each LSP worker SHALL follow the standard LSP server lifecycle.

#### Scenario: Initialization
- **GIVEN** the background service worker spawns a new Web Worker for a language
- **WHEN** the WASM binary is loaded and instantiated
- **THEN** the worker SHALL:
  1. Accept an `initialize` JSON-RPC request with `InitializeParams`
  2. Respond with `InitializeResult` declaring supported capabilities (at minimum: `hoverProvider`, `definitionProvider`)
  3. Accept the `initialized` notification
  4. Be ready to process requests

#### Scenario: Shutdown
- **GIVEN** the background service worker sends a `shutdown` request
- **WHEN** the worker receives it
- **THEN** the worker SHALL stop accepting new requests, finish any in-progress requests, and respond with `null`

#### Scenario: Exit
- **GIVEN** a `shutdown` response has been sent
- **WHEN** the worker receives an `exit` notification
- **THEN** the worker SHALL terminate cleanly, releasing all WASM memory

---

## Requirement: JSON-RPC 2.0 Transport

The LSP worker SHALL communicate using JSON-RPC 2.0 over `postMessage`.

#### Scenario: Request Handling
- **GIVEN** the background sends a JSON-RPC request via `postMessage`
- **WHEN** the worker receives the message
- **THEN** the worker SHALL parse the JSON-RPC envelope, dispatch to the appropriate LSP handler, and respond with a JSON-RPC response via `postMessage`

#### Scenario: Notification Handling
- **GIVEN** the background sends a JSON-RPC notification (no `id` field)
- **WHEN** the worker receives the message
- **THEN** the worker SHALL process the notification without sending a response

#### Scenario: Error Handling
- **GIVEN** a request results in an error
- **WHEN** the worker processes the request
- **THEN** the worker SHALL respond with a JSON-RPC error object containing an appropriate LSP error code and message

---

## Requirement: textDocument/hover

The LSP worker SHALL support the `textDocument/hover` request.

#### Scenario: Hover on Known Symbol
- **GIVEN** a `textDocument/hover` request arrives with a valid position
- **WHEN** the position corresponds to a known symbol (variable, function, type, etc.)
- **THEN** the worker SHALL respond with a `Hover` object containing:
  - `contents`: `MarkupContent` with `kind: "markdown"` including:
    - Type signature / function signature
    - Parameter names and types
    - Return type
    - Brief documentation (JSDoc, GoDoc, docstring, etc.) if available
  - `range`: The range of the token that was hovered

#### Scenario: Hover on Unknown Position
- **GIVEN** a `textDocument/hover` request arrives with a position
- **WHEN** the position does not correspond to any known symbol (whitespace, punctuation, unknown token)
- **THEN** the worker SHALL respond with `null`

#### Scenario: Hover on Import/Module Reference
- **GIVEN** a `textDocument/hover` request arrives on an import path or module reference
- **WHEN** the module is resolved
- **THEN** the worker SHALL respond with the module's description and export summary

---

## Requirement: textDocument/definition

The LSP worker SHALL support the `textDocument/definition` request.

#### Scenario: Definition Found in Same File
- **GIVEN** a `textDocument/definition` request for a symbol defined in the current file
- **WHEN** the definition is resolved
- **THEN** the worker SHALL respond with a `Location` pointing to the definition's file URI and range

#### Scenario: Definition Found in Different File
- **GIVEN** a `textDocument/definition` request for a symbol defined in a different file
- **WHEN** the definition is resolved
- **THEN** the worker SHALL respond with a `Location` pointing to the external file's URI and range

#### Scenario: Definition Not Found
- **GIVEN** a `textDocument/definition` request for a symbol whose definition cannot be resolved
- **WHEN** the resolution fails
- **THEN** the worker SHALL respond with an empty `Location[]`

---

## Requirement: textDocument/signatureHelp

The LSP worker SHALL support the `textDocument/signatureHelp` request.

#### Scenario: Inside Function Call
- **GIVEN** the cursor position is inside a function call's argument list
- **WHEN** a `textDocument/signatureHelp` request is received
- **THEN** the worker SHALL respond with `SignatureHelp` containing:
  - `signatures`: Array of possible function signatures
  - `activeSignature`: Index of the most likely signature
  - `activeParameter`: Index of the parameter at the cursor position

---

## Requirement: Virtual File System

The LSP worker SHALL operate with a virtual in-memory file system since it runs in a browser context.

#### Scenario: File Registration
- **GIVEN** the background sends a `textDocument/didOpen` notification with file content
- **WHEN** the worker processes the notification
- **THEN** the worker SHALL store the file content in its virtual file system, indexed by the document URI

#### Scenario: File Not Found
- **GIVEN** the language server attempts to resolve a file not in the virtual file system
- **WHEN** the resolution fails
- **THEN** the worker SHALL send a custom notification `gh-lsp/requestFile` to the background, requesting the file be fetched and provided via `textDocument/didOpen`

---

## Requirement: Supported Language Servers

The extension SHALL ship with WASM-compiled language servers for the following languages (initial release):

#### Scenario: TypeScript/JavaScript Support
- **GIVEN** a file with extension `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`
- **WHEN** the language is detected
- **THEN** the extension SHALL use a TypeScript language server providing full type information, JSDoc, and definition resolution

#### Scenario: Go Support
- **GIVEN** a file with extension `.go`
- **WHEN** the language is detected
- **THEN** the extension SHALL use a Go language server (gopls-equivalent) providing type information, GoDoc, and definition resolution

#### Scenario: Rust Support
- **GIVEN** a file with extension `.rs`
- **WHEN** the language is detected
- **THEN** the extension SHALL use a Rust language server (rust-analyzer-equivalent) providing type information, doc comments, and definition resolution

#### Scenario: Python Support
- **GIVEN** a file with extension `.py`, `.pyi`
- **WHEN** the language is detected
- **THEN** the extension SHALL use a Python language server providing type information (with type stubs), docstrings, and definition resolution
