# Phase 5: Content Script — Task Details

## Prerequisites
- P1-T1 (Shared Types) complete
- P1-T2 (Message Protocol) complete
- P1-T3 (Constants) complete
- P1-T5 (Language Registry) complete

## Tasks

### P5-T1: Page Detector (`src/content/page-detector.ts`)

**Purpose**: Detect which type of GitHub code page the user is on, extract repository context.

**Implementation guide**:

```typescript
// URL patterns
const BLOB_PATTERN = /^\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/;
const PR_FILES_PATTERN = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/files$/;
const COMPARE_PATTERN = /^\/([^/]+)\/([^/]+)\/compare\/(.+)$/;

export function detectPageType(url: string): GitHubViewType | null;
export function extractRepoContext(url: string): RepoContext | null;
export function extractDiffContexts(url: string): DiffFileContext[];

// Turbo navigation handling
export function onPageNavigation(callback: (url: string) => void): () => void;
```

**Key behaviors**:
- Parses `window.location.pathname` against URL patterns
- For blob view: extracts owner, repo, ref (branch/tag/SHA), filePath
- For PR files: extracts owner, repo, PR number (ref determined from API or DOM)
- For compare: extracts owner, repo, base..head refs
- Turbo: listens for `turbo:load` event for SPA navigation detection
- Returns `null` for non-code pages (Issues, Settings, etc.)

**Edge cases to handle**:
- Nested file paths with `/` (e.g., `src/utils/helpers.ts`)
- Branch names with `/` (e.g., `feature/my-branch`) — GitHub resolves this in blob URL
- Refs that are SHA hashes vs branch names
- URLs with query parameters or fragments

**Tests required**:
- Blob URL parsing (various path depths)
- PR files URL parsing
- Compare URL parsing
- Non-code page returns null
- URLs with special characters
- Turbo event listener setup/teardown

---

### P5-T2: DOM Observer (`src/content/dom-observer.ts`)

**Purpose**: Watch GitHub's code container for line additions/removals from virtualized rendering.

**Implementation guide**:

```typescript
export interface DomObserverCallbacks {
  onLinesAdded: (elements: Element[]) => void;
  onLinesRemoved: (elements: Element[]) => void;
}

export class CodeDomObserver {
  private observer: MutationObserver | null = null;

  constructor(private callbacks: DomObserverCallbacks);

  startObserving(container: Element): void;
  stopObserving(): void;

  // Find the code container element on the page
  static findCodeContainer(): Element | null;
}
```

**GitHub DOM structure** (as of 2024):
- Code is rendered in `<div class="react-code-lines">` or `<table class="highlight">` elements
- Each line is a `<div>` or `<tr>` with syntax-highlighted `<span>` children
- CSS class names are minified and change across deployments
- Use structural selectors rather than class names where possible

**Key behaviors**:
- MutationObserver on code container with `childList: true, subtree: true`
- Filters mutations to identify code line additions vs other DOM changes
- Batches callbacks via `requestAnimationFrame` to avoid excessive processing
- Handles both blob view (single file) and diff view (split panes)

**Tests required**:
- Observer detects added line elements
- Observer detects removed line elements
- Cleanup disconnects observer
- findCodeContainer returns correct element (mock DOM)

---

### P5-T3: Token Detector (`src/content/token-detector.ts`)

**Purpose**: Detect mouse hover on code tokens and compute LSP positions.

**Implementation guide**:

```typescript
export interface TokenHoverContext {
  element: Element;
  tokenText: string;
  line: number;        // 0-indexed
  character: number;   // 0-indexed
  filePath: string;
}

export class TokenDetector {
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private currentToken: Element | null = null;

  constructor(
    private debounceMs: number,
    private onHover: (context: TokenHoverContext) => void,
    private onLeave: () => void
  );

  attachToLine(lineElement: Element): void;
  detachFromLine(lineElement: Element): void;
  detachAll(): void;

  private handleMouseEnter(event: MouseEvent, lineElement: Element): void;
  private handleMouseLeave(event: MouseEvent): void;
  private computePosition(element: Element, lineElement: Element): { line: number; character: number };
}
```

**Position computation**:
1. **Line number**: From `data-line-number` attribute or DOM position index
2. **Character offset**: Walk the text nodes in the line element, counting characters until reaching the hovered span's start offset + cursor position within the span

**Key behaviors**:
- Debounce: only triggers `onHover` after cursor is stationary for `debounceMs`
- Cancellation: mouse leaving token before debounce clears the timer
- Handles rapid mouse movement between tokens
- Text selection: `mouseup` event triggers hover at selection start

**Tests required**:
- Debounce fires after delay
- Mouse leave cancels pending hover
- Position calculation correct for various token positions
- Rapid movement only fires for last token

---

### P5-T4: Messaging Layer (`src/content/messaging.ts`)

**Purpose**: Content-script side of the extension messaging protocol.

**Implementation guide**:

```typescript
export class ContentMessaging {
  private pendingRequests: Map<string, {
    resolve: (response: ExtensionMessage) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = new Map();

  async sendHoverRequest(
    context: RepoContext, position: LspPosition
  ): Promise<LspHoverResponse>;

  async sendDefinitionRequest(
    context: RepoContext, position: LspPosition
  ): Promise<LspDefinitionResponse>;

  async sendSignatureHelpRequest(
    context: RepoContext, position: LspPosition
  ): Promise<LspSignatureHelpResponse>;

  cancelRequest(requestId: string): void;
  cancelAll(): void;

  // Setup listener for background-initiated messages
  startListening(
    onNotification: (message: ExtensionMessage) => void
  ): () => void;
}
```

**Key behaviors**:
- Each request generates a unique `requestId`
- `chrome.runtime.sendMessage` sends to background, response comes via callback
- Timeout: rejects after configurable period (default 10s)
- `cancelRequest`: sends `lsp/cancel` message, rejects pending promise
- `cancelAll`: cancels all pending requests (used on navigation)
- Listens for notifications: `rateLimit/warning`, `worker/status`, `settings/changed`

**Tests required**:
- Request sent with correct type and fields
- Response resolves correct pending promise
- Timeout rejects
- Cancel sends cancel message and rejects
- CancelAll cleans up all pending

---

### P5-T5: Content Script Entry Point (`src/content/index.ts`)

**Purpose**: Orchestrate all content script modules into a cohesive lifecycle.

**Implementation guide**:

```typescript
class GhLspContentScript {
  private pageDetector: ReturnType<typeof onPageNavigation> | null = null;
  private domObserver: CodeDomObserver | null = null;
  private tokenDetector: TokenDetector | null = null;
  private messaging: ContentMessaging;
  private currentContext: RepoContext | null = null;

  initialize(): void;
  private activate(context: RepoContext): void;
  private deactivate(): void;
  private handleHoverResult(response: ExtensionMessage): void;
  private handleNotification(message: ExtensionMessage): void;
}

// Self-executing initialization
const extension = new GhLspContentScript();
extension.initialize();
```

**Lifecycle**:
1. On load: detect page type
2. If code page: extract context → start DOM observer → start token detector → notify background
3. On Turbo navigation: deactivate → re-detect → re-activate if code page
4. On hover: send request → show loading → display result
5. On deactivate: cancel pending requests → tear down observers

**Tests required**: Integration test for lifecycle (init, activate, deactivate, re-activate).

---

## Parallelization Notes

- P5-T1 can start immediately (depends only on P1-T1)
- P5-T2 depends on P5-T1 (needs page context)
- P5-T3 depends on P5-T2 (needs DOM observer for line elements)
- P5-T4 can be built in parallel with P5-T2 and P5-T3 (depends only on P1-T2)
- P5-T5 depends on all other P5 tasks
