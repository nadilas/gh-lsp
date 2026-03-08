import type {
  ExtensionMessage,
  LspHoverRequest,
  LspDefinitionRequest,
  LspSignatureHelpRequest,
  LspCancelRequest,
  LspHoverResponse,
  LspDefinitionResponse,
  LspSignatureHelpResponse,
  LspErrorResponse,
  LspPosition,
  LspHover,
  LspLocation,
  LspSignatureHelp,
  ExtensionError,
  MessageType,
} from './types';

// ─── Request ID Generation ───────────────────────────────────────────────────

/**
 * Generates a unique request ID using crypto.randomUUID().
 * Each call produces a globally unique identifier for correlating
 * requests with responses across the messaging boundary.
 */
export function generateRequestId(): string {
  return crypto.randomUUID();
}

// ─── Request Factories ──────────────────────────────────────────────────────

/**
 * Creates a hover request message sent from content script to background.
 * The background will route this to the appropriate LSP worker based on the
 * file's language and return type information for the symbol at the position.
 */
export function createHoverRequest(
  owner: string,
  repo: string,
  ref: string,
  filePath: string,
  position: LspPosition,
): LspHoverRequest {
  return {
    type: 'lsp/hover',
    requestId: generateRequestId(),
    owner,
    repo,
    ref,
    filePath,
    position,
  };
}

/**
 * Creates a definition request message to find where a symbol is defined.
 * Returns locations that can be used to navigate to the definition site.
 */
export function createDefinitionRequest(
  owner: string,
  repo: string,
  ref: string,
  filePath: string,
  position: LspPosition,
): LspDefinitionRequest {
  return {
    type: 'lsp/definition',
    requestId: generateRequestId(),
    owner,
    repo,
    ref,
    filePath,
    position,
  };
}

/**
 * Creates a signature help request for function call parameter information.
 * Triggered when the cursor is inside a function call's argument list.
 */
export function createSignatureHelpRequest(
  owner: string,
  repo: string,
  ref: string,
  filePath: string,
  position: LspPosition,
): LspSignatureHelpRequest {
  return {
    type: 'lsp/signatureHelp',
    requestId: generateRequestId(),
    owner,
    repo,
    ref,
    filePath,
    position,
  };
}

/**
 * Creates a cancel request to abort an in-flight LSP request.
 * The requestId must match the original request that should be cancelled.
 */
export function createCancelRequest(requestId: string): LspCancelRequest {
  return {
    type: 'lsp/cancel',
    requestId,
  };
}

// ─── Response Factories ─────────────────────────────────────────────────────

/**
 * Creates a hover response containing type/symbol information.
 * Result is null when no symbol exists at the requested position.
 */
export function createHoverResponse(
  requestId: string,
  result: LspHover | null,
): LspHoverResponse {
  return {
    type: 'lsp/response',
    requestId,
    kind: 'hover',
    result,
  };
}

/**
 * Creates a definition response with an array of definition locations.
 * Empty array indicates no definition was found for the symbol.
 */
export function createDefinitionResponse(
  requestId: string,
  result: LspLocation[],
): LspDefinitionResponse {
  return {
    type: 'lsp/response',
    requestId,
    kind: 'definition',
    result,
  };
}

/**
 * Creates a signature help response with function signatures.
 * Result is null when cursor is not inside a function call.
 */
export function createSignatureHelpResponse(
  requestId: string,
  result: LspSignatureHelp | null,
): LspSignatureHelpResponse {
  return {
    type: 'lsp/response',
    requestId,
    kind: 'signatureHelp',
    result,
  };
}

/**
 * Creates an error response for a failed LSP request.
 * The error code determines how the UI handles the error (retry, dismiss, etc.).
 */
export function createErrorResponse(
  requestId: string,
  error: ExtensionError,
): LspErrorResponse {
  return {
    type: 'lsp/error',
    requestId,
    error,
  };
}

// ─── Message Type Guards ────────────────────────────────────────────────────

/** All valid message type strings for runtime validation */
const VALID_MESSAGE_TYPES: ReadonlySet<MessageType> = new Set<MessageType>([
  'lsp/hover',
  'lsp/definition',
  'lsp/signatureHelp',
  'lsp/cancel',
  'lsp/response',
  'lsp/error',
  'settings/changed',
  'rateLimit/warning',
  'worker/status',
  'extension/toggle',
  'page/navigated',
]);

/** Message types that represent LSP requests from content script to background */
const LSP_REQUEST_TYPES: ReadonlySet<MessageType> = new Set<MessageType>([
  'lsp/hover',
  'lsp/definition',
  'lsp/signatureHelp',
  'lsp/cancel',
]);

/** Message types that represent LSP responses from background to content script */
const LSP_RESPONSE_TYPES: ReadonlySet<MessageType> = new Set<MessageType>([
  'lsp/response',
  'lsp/error',
]);

/**
 * Runtime type guard that validates whether an unknown value is a well-formed
 * ExtensionMessage. Checks structural shape — that `type` is a known
 * MessageType string and that required fields exist for that message type.
 *
 * This is the first line of defense against malformed messages arriving
 * via chrome.runtime messaging from potentially compromised contexts.
 */
export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  if (value === null || value === undefined || typeof value !== 'object') {
    return false;
  }

  const msg = value as Record<string, unknown>;

  // Every message must have a string `type` field that's a known MessageType
  if (typeof msg['type'] !== 'string') {
    return false;
  }

  if (!VALID_MESSAGE_TYPES.has(msg['type'] as MessageType)) {
    return false;
  }

  const type = msg['type'] as MessageType;

  // Validate required fields per message type
  switch (type) {
    case 'lsp/hover':
    case 'lsp/definition':
    case 'lsp/signatureHelp':
      return (
        typeof msg['requestId'] === 'string' &&
        msg['requestId'].length > 0 &&
        typeof msg['owner'] === 'string' &&
        typeof msg['repo'] === 'string' &&
        typeof msg['ref'] === 'string' &&
        typeof msg['filePath'] === 'string' &&
        isValidPosition(msg['position'])
      );

    case 'lsp/cancel':
      return (
        typeof msg['requestId'] === 'string' && msg['requestId'].length > 0
      );

    case 'lsp/response':
      return (
        typeof msg['requestId'] === 'string' &&
        msg['requestId'].length > 0 &&
        typeof msg['kind'] === 'string' &&
        (msg['kind'] === 'hover' ||
          msg['kind'] === 'definition' ||
          msg['kind'] === 'signatureHelp')
      );

    case 'lsp/error':
      return (
        typeof msg['requestId'] === 'string' &&
        msg['requestId'].length > 0 &&
        isValidExtensionError(msg['error'])
      );

    case 'settings/changed':
      return (
        msg['changes'] !== null &&
        msg['changes'] !== undefined &&
        typeof msg['changes'] === 'object'
      );

    case 'rateLimit/warning':
      return typeof msg['resetAt'] === 'number';

    case 'worker/status':
      return (
        typeof msg['language'] === 'string' &&
        typeof msg['status'] === 'string'
      );

    case 'extension/toggle':
      return typeof msg['enabled'] === 'boolean';

    case 'page/navigated':
      return (
        msg['newContext'] === null ||
        (typeof msg['newContext'] === 'object' &&
          msg['newContext'] !== undefined)
      );

    default:
      return false;
  }
}

/**
 * Discriminates whether a validated ExtensionMessage is an LSP request
 * (content script → background direction). Useful for the background
 * service worker's message dispatch to route LSP-specific messages.
 */
export function isLspRequest(
  message: ExtensionMessage,
): message is
  | LspHoverRequest
  | LspDefinitionRequest
  | LspSignatureHelpRequest
  | LspCancelRequest {
  return LSP_REQUEST_TYPES.has(message.type);
}

/**
 * Discriminates whether a validated ExtensionMessage is an LSP response
 * (background → content script direction). Useful for the content script's
 * message handler to route responses back to pending request promises.
 */
export function isLspResponse(
  message: ExtensionMessage,
): message is
  | LspHoverResponse
  | LspDefinitionResponse
  | LspSignatureHelpResponse
  | LspErrorResponse {
  return LSP_RESPONSE_TYPES.has(message.type);
}

// ─── Internal Validation Helpers ────────────────────────────────────────────

function isValidPosition(value: unknown): value is LspPosition {
  if (value === null || value === undefined || typeof value !== 'object') {
    return false;
  }
  const pos = value as Record<string, unknown>;
  return (
    typeof pos['line'] === 'number' &&
    typeof pos['character'] === 'number' &&
    Number.isInteger(pos['line']) &&
    Number.isInteger(pos['character']) &&
    pos['line'] >= 0 &&
    pos['character'] >= 0
  );
}

function isValidExtensionError(value: unknown): value is ExtensionError {
  if (value === null || value === undefined || typeof value !== 'object') {
    return false;
  }
  const err = value as Record<string, unknown>;
  return (
    typeof err['code'] === 'string' && typeof err['message'] === 'string'
  );
}
