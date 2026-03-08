# Background Service Worker — Specification

## Overview

The background service worker is the central orchestrator of the extension. It receives LSP requests from content scripts, manages Web Worker pools for language servers, routes requests to the appropriate LSP server, caches results, and handles the lifecycle of WASM-based language servers.

---

## Requirement: LSP Request Routing

The background service worker SHALL route incoming LSP requests from content scripts to the appropriate language server worker.

#### Scenario: Route Hover Request
- **GIVEN** a content script sends an `lsp/hover` message with file metadata
- **WHEN** the background service worker receives the message
- **THEN** it SHALL:
  1. Determine the programming language from the file extension
  2. Check if a worker for that language is already running
  3. If not, start the appropriate language server worker
  4. Forward the hover request as a JSON-RPC `textDocument/hover` call to the worker
  5. Return the response to the requesting content script

#### Scenario: Route Definition Request
- **GIVEN** a content script sends an `lsp/definition` message
- **WHEN** the background service worker receives the message
- **THEN** it SHALL route the request as a `textDocument/definition` JSON-RPC call and return `Location[]` results

#### Scenario: Unsupported Language
- **GIVEN** a content script sends a request for a language with no available LSP server
- **WHEN** the background service worker processes the request
- **THEN** it SHALL return an error response with type `unsupported_language` and the language identifier

---

## Requirement: Web Worker Pool Management

The background service worker SHALL manage a pool of Web Workers, each running a WASM-compiled language server.

#### Scenario: Worker Initialization
- **GIVEN** a request arrives for a language that has no active worker
- **WHEN** the background service worker determines a worker is needed
- **THEN** it SHALL:
  1. Spawn a new Web Worker
  2. Load the WASM binary for the language server into the worker
  3. Send the LSP `initialize` request with appropriate capabilities
  4. Wait for the `initialized` notification before forwarding requests

#### Scenario: Worker Reuse
- **GIVEN** a worker for language X is already running and initialized
- **WHEN** a new request arrives for language X
- **THEN** the background service worker SHALL reuse the existing worker

#### Scenario: Worker Idle Timeout
- **GIVEN** a language server worker has been idle (no requests) for a configurable period (default: 5 minutes)
- **WHEN** the idle timeout expires
- **THEN** the background service worker SHALL send an LSP `shutdown` request followed by `exit`, then terminate the Web Worker to free resources

#### Scenario: Worker Crash Recovery
- **GIVEN** a Web Worker crashes or becomes unresponsive
- **WHEN** the background service worker detects the failure (via `onerror` or request timeout)
- **THEN** it SHALL:
  1. Terminate the failed worker
  2. Reject any pending requests with an `lsp_server_error` error
  3. On the next request for that language, spawn a fresh worker

#### Scenario: Maximum Worker Limit
- **GIVEN** the maximum number of concurrent workers (configurable, default: 4) is reached
- **WHEN** a request arrives for a new language requiring a new worker
- **THEN** the background service worker SHALL evict the least-recently-used worker before spawning a new one

---

## Requirement: Document Synchronization

The background service worker SHALL synchronize document content with the LSP servers.

#### Scenario: Open Document
- **GIVEN** the content script reports that a file is being viewed
- **WHEN** the background service worker receives the first request for that file
- **THEN** it SHALL:
  1. Fetch the file's raw content from GitHub's API (`GET /repos/{owner}/{repo}/contents/{path}?ref={ref}`) or from the page DOM
  2. Send a `textDocument/didOpen` notification to the language server with the file URI and content

#### Scenario: File Content Caching
- **GIVEN** the raw content for a file has already been fetched
- **WHEN** another hover request arrives for the same file, owner, repo, and ref
- **THEN** the background service worker SHALL use the cached content without re-fetching

#### Scenario: Cross-File Resolution
- **GIVEN** the language server requests additional files for type resolution (e.g., imported modules)
- **WHEN** the language server sends a workspace request or the background detects an unresolved import
- **THEN** the background service worker SHALL fetch the required files from GitHub's API and provide them to the language server via `textDocument/didOpen`

---

## Requirement: Response Caching

The background service worker SHALL cache LSP responses to improve responsiveness.

#### Scenario: Cache Hover Result
- **GIVEN** a hover response is received from a language server
- **WHEN** the response is successful (non-null)
- **THEN** the background service worker SHALL cache the result keyed by `{owner}/{repo}/{ref}/{filePath}:{line}:{character}`

#### Scenario: Serve Cached Result
- **GIVEN** a hover request arrives for a position that has a cached result
- **WHEN** the cache entry is not expired (TTL: configurable, default: 10 minutes)
- **THEN** the background service worker SHALL return the cached result without querying the language server

#### Scenario: Cache Invalidation
- **GIVEN** the user navigates to a different ref (branch/commit) for the same file
- **WHEN** the ref changes
- **THEN** the background service worker SHALL invalidate all cached results for that file under the old ref

---

## Requirement: GitHub API Integration

The background service worker SHALL interact with GitHub's REST API to fetch file contents and repository metadata.

#### Scenario: Authenticated Requests
- **GIVEN** the user has configured a Personal Access Token (PAT) in extension settings
- **WHEN** the background makes a GitHub API request
- **THEN** it SHALL include the PAT in the `Authorization` header

#### Scenario: Unauthenticated Requests
- **GIVEN** no PAT is configured
- **WHEN** the background makes a GitHub API request
- **THEN** it SHALL attempt the request without authentication (subject to lower rate limits)

#### Scenario: Rate Limit Handling
- **GIVEN** a GitHub API response returns HTTP 403 or 429 with rate limit headers
- **WHEN** the background service worker receives the response
- **THEN** it SHALL:
  1. Read the `X-RateLimit-Reset` header
  2. Queue pending requests
  3. Implement exponential backoff with jitter
  4. Notify the content script to display a rate limit warning

#### Scenario: API Error Handling
- **GIVEN** a GitHub API request fails (network error, 404, 500)
- **WHEN** the error occurs
- **THEN** the background service worker SHALL return a descriptive error to the content script and NOT crash
