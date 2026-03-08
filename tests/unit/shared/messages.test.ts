import { describe, it, expect } from 'vitest';
import {
  generateRequestId,
  createHoverRequest,
  createDefinitionRequest,
  createSignatureHelpRequest,
  createCancelRequest,
  createHoverResponse,
  createDefinitionResponse,
  createSignatureHelpResponse,
  createErrorResponse,
  isExtensionMessage,
  isLspRequest,
  isLspResponse,
} from '../../../src/shared/messages';
import type {
  LspPosition,
  LspHover,
  LspLocation,
  LspSignatureHelp,
  ExtensionError,
  ExtensionMessage,
} from '../../../src/shared/types';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const position: LspPosition = { line: 10, character: 5 };
const owner = 'torvalds';
const repo = 'linux';
const ref = 'main';
const filePath = 'kernel/main.c';

const hoverResult: LspHover = {
  contents: { kind: 'markdown', value: '```c\nvoid main()\n```' },
  range: { start: { line: 10, character: 5 }, end: { line: 10, character: 9 } },
};

const definitionResult: LspLocation[] = [
  {
    uri: 'file:///kernel/main.c',
    range: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 10 },
    },
  },
];

const signatureHelpResult: LspSignatureHelp = {
  signatures: [
    {
      label: 'fn(a: number, b: string): void',
      documentation: { kind: 'plaintext', value: 'A test function' },
      parameters: [
        { label: 'a', documentation: 'first param' },
        { label: 'b', documentation: 'second param' },
      ],
    },
  ],
  activeSignature: 0,
  activeParameter: 1,
};

const extensionError: ExtensionError = {
  code: 'lsp_server_error',
  message: 'Language server crashed',
};

// ─── generateRequestId ──────────────────────────────────────────────────────

describe('generateRequestId', () => {
  it('returns a string', () => {
    const id = generateRequestId();
    expect(typeof id).toBe('string');
  });

  it('returns a valid UUID format', () => {
    const id = generateRequestId();
    // UUID v4 format: 8-4-4-4-12 hex characters
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('generates unique IDs across multiple calls', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(generateRequestId());
    }
    // All 1000 IDs should be unique
    expect(ids.size).toBe(1000);
  });
});

// ─── Request Factories ──────────────────────────────────────────────────────

describe('createHoverRequest', () => {
  it('creates a well-formed hover request', () => {
    const req = createHoverRequest(owner, repo, ref, filePath, position);
    expect(req.type).toBe('lsp/hover');
    expect(req.owner).toBe(owner);
    expect(req.repo).toBe(repo);
    expect(req.ref).toBe(ref);
    expect(req.filePath).toBe(filePath);
    expect(req.position).toEqual(position);
    expect(typeof req.requestId).toBe('string');
    expect(req.requestId.length).toBeGreaterThan(0);
  });

  it('generates a unique requestId for each call', () => {
    const req1 = createHoverRequest(owner, repo, ref, filePath, position);
    const req2 = createHoverRequest(owner, repo, ref, filePath, position);
    expect(req1.requestId).not.toBe(req2.requestId);
  });
});

describe('createDefinitionRequest', () => {
  it('creates a well-formed definition request', () => {
    const req = createDefinitionRequest(owner, repo, ref, filePath, position);
    expect(req.type).toBe('lsp/definition');
    expect(req.owner).toBe(owner);
    expect(req.repo).toBe(repo);
    expect(req.ref).toBe(ref);
    expect(req.filePath).toBe(filePath);
    expect(req.position).toEqual(position);
    expect(typeof req.requestId).toBe('string');
  });
});

describe('createSignatureHelpRequest', () => {
  it('creates a well-formed signatureHelp request', () => {
    const req = createSignatureHelpRequest(
      owner,
      repo,
      ref,
      filePath,
      position,
    );
    expect(req.type).toBe('lsp/signatureHelp');
    expect(req.owner).toBe(owner);
    expect(req.repo).toBe(repo);
    expect(req.ref).toBe(ref);
    expect(req.filePath).toBe(filePath);
    expect(req.position).toEqual(position);
    expect(typeof req.requestId).toBe('string');
  });
});

describe('createCancelRequest', () => {
  it('creates a well-formed cancel request', () => {
    const originalId = generateRequestId();
    const req = createCancelRequest(originalId);
    expect(req.type).toBe('lsp/cancel');
    expect(req.requestId).toBe(originalId);
  });
});

// ─── Response Factories ─────────────────────────────────────────────────────

describe('createHoverResponse', () => {
  it('creates a hover response with result', () => {
    const res = createHoverResponse('req-1', hoverResult);
    expect(res.type).toBe('lsp/response');
    expect(res.requestId).toBe('req-1');
    expect(res.kind).toBe('hover');
    expect(res.result).toEqual(hoverResult);
  });

  it('creates a hover response with null result', () => {
    const res = createHoverResponse('req-2', null);
    expect(res.type).toBe('lsp/response');
    expect(res.requestId).toBe('req-2');
    expect(res.kind).toBe('hover');
    expect(res.result).toBeNull();
  });
});

describe('createDefinitionResponse', () => {
  it('creates a definition response with locations', () => {
    const res = createDefinitionResponse('req-3', definitionResult);
    expect(res.type).toBe('lsp/response');
    expect(res.requestId).toBe('req-3');
    expect(res.kind).toBe('definition');
    expect(res.result).toEqual(definitionResult);
  });

  it('creates a definition response with empty array', () => {
    const res = createDefinitionResponse('req-4', []);
    expect(res.result).toEqual([]);
  });
});

describe('createSignatureHelpResponse', () => {
  it('creates a signatureHelp response with result', () => {
    const res = createSignatureHelpResponse('req-5', signatureHelpResult);
    expect(res.type).toBe('lsp/response');
    expect(res.requestId).toBe('req-5');
    expect(res.kind).toBe('signatureHelp');
    expect(res.result).toEqual(signatureHelpResult);
  });

  it('creates a signatureHelp response with null result', () => {
    const res = createSignatureHelpResponse('req-6', null);
    expect(res.result).toBeNull();
  });
});

describe('createErrorResponse', () => {
  it('creates an error response', () => {
    const res = createErrorResponse('req-7', extensionError);
    expect(res.type).toBe('lsp/error');
    expect(res.requestId).toBe('req-7');
    expect(res.error).toEqual(extensionError);
  });

  it('preserves optional error fields', () => {
    const errorWithExtras: ExtensionError = {
      code: 'rate_limited',
      message: 'Rate limit exceeded',
      retryAfter: 3600,
      language: 'typescript',
    };
    const res = createErrorResponse('req-8', errorWithExtras);
    expect(res.error.retryAfter).toBe(3600);
    expect(res.error.language).toBe('typescript');
  });
});

// ─── isExtensionMessage ─────────────────────────────────────────────────────

describe('isExtensionMessage', () => {
  // --- Valid messages ---

  it('validates a well-formed hover request', () => {
    const msg = createHoverRequest(owner, repo, ref, filePath, position);
    expect(isExtensionMessage(msg)).toBe(true);
  });

  it('validates a well-formed definition request', () => {
    const msg = createDefinitionRequest(owner, repo, ref, filePath, position);
    expect(isExtensionMessage(msg)).toBe(true);
  });

  it('validates a well-formed signatureHelp request', () => {
    const msg = createSignatureHelpRequest(
      owner,
      repo,
      ref,
      filePath,
      position,
    );
    expect(isExtensionMessage(msg)).toBe(true);
  });

  it('validates a well-formed cancel request', () => {
    const msg = createCancelRequest('some-id');
    expect(isExtensionMessage(msg)).toBe(true);
  });

  it('validates a well-formed hover response', () => {
    const msg = createHoverResponse('req-1', hoverResult);
    expect(isExtensionMessage(msg)).toBe(true);
  });

  it('validates a well-formed definition response', () => {
    const msg = createDefinitionResponse('req-1', definitionResult);
    expect(isExtensionMessage(msg)).toBe(true);
  });

  it('validates a well-formed signatureHelp response', () => {
    const msg = createSignatureHelpResponse('req-1', signatureHelpResult);
    expect(isExtensionMessage(msg)).toBe(true);
  });

  it('validates a well-formed error response', () => {
    const msg = createErrorResponse('req-1', extensionError);
    expect(isExtensionMessage(msg)).toBe(true);
  });

  it('validates a settings/changed message', () => {
    expect(
      isExtensionMessage({
        type: 'settings/changed',
        changes: { enabled: false },
      }),
    ).toBe(true);
  });

  it('validates a rateLimit/warning message', () => {
    expect(
      isExtensionMessage({ type: 'rateLimit/warning', resetAt: 1700000000 }),
    ).toBe(true);
  });

  it('validates a worker/status message', () => {
    expect(
      isExtensionMessage({
        type: 'worker/status',
        language: 'typescript',
        status: 'ready',
      }),
    ).toBe(true);
  });

  it('validates an extension/toggle message', () => {
    expect(
      isExtensionMessage({ type: 'extension/toggle', enabled: true }),
    ).toBe(true);
  });

  it('validates a page/navigated message with context', () => {
    expect(
      isExtensionMessage({
        type: 'page/navigated',
        newContext: { owner: 'a', repo: 'b', ref: 'c', filePath: 'd', language: 'go' },
      }),
    ).toBe(true);
  });

  it('validates a page/navigated message with null context', () => {
    expect(
      isExtensionMessage({ type: 'page/navigated', newContext: null }),
    ).toBe(true);
  });

  // --- Malformed / invalid input rejection ---

  it('rejects null', () => {
    expect(isExtensionMessage(null)).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isExtensionMessage(undefined)).toBe(false);
  });

  it('rejects a string', () => {
    expect(isExtensionMessage('lsp/hover')).toBe(false);
  });

  it('rejects a number', () => {
    expect(isExtensionMessage(42)).toBe(false);
  });

  it('rejects an array', () => {
    expect(isExtensionMessage([1, 2, 3])).toBe(false);
  });

  it('rejects an empty object', () => {
    expect(isExtensionMessage({})).toBe(false);
  });

  it('rejects an object with an unknown type', () => {
    expect(isExtensionMessage({ type: 'unknown/type' })).toBe(false);
  });

  it('rejects an object with a numeric type', () => {
    expect(isExtensionMessage({ type: 123 })).toBe(false);
  });

  it('rejects a hover request missing position', () => {
    expect(
      isExtensionMessage({
        type: 'lsp/hover',
        requestId: 'abc',
        owner,
        repo,
        ref,
        filePath,
        // position missing
      }),
    ).toBe(false);
  });

  it('rejects a hover request with invalid position (negative line)', () => {
    expect(
      isExtensionMessage({
        type: 'lsp/hover',
        requestId: 'abc',
        owner,
        repo,
        ref,
        filePath,
        position: { line: -1, character: 0 },
      }),
    ).toBe(false);
  });

  it('rejects a hover request with non-integer position', () => {
    expect(
      isExtensionMessage({
        type: 'lsp/hover',
        requestId: 'abc',
        owner,
        repo,
        ref,
        filePath,
        position: { line: 1.5, character: 0 },
      }),
    ).toBe(false);
  });

  it('rejects a hover request with empty requestId', () => {
    expect(
      isExtensionMessage({
        type: 'lsp/hover',
        requestId: '',
        owner,
        repo,
        ref,
        filePath,
        position,
      }),
    ).toBe(false);
  });

  it('rejects a cancel request with empty requestId', () => {
    expect(
      isExtensionMessage({ type: 'lsp/cancel', requestId: '' }),
    ).toBe(false);
  });

  it('rejects a lsp/response with unknown kind', () => {
    expect(
      isExtensionMessage({
        type: 'lsp/response',
        requestId: 'abc',
        kind: 'unknown',
        result: null,
      }),
    ).toBe(false);
  });

  it('rejects a lsp/error with missing error object', () => {
    expect(
      isExtensionMessage({ type: 'lsp/error', requestId: 'abc' }),
    ).toBe(false);
  });

  it('rejects a lsp/error with malformed error (missing code)', () => {
    expect(
      isExtensionMessage({
        type: 'lsp/error',
        requestId: 'abc',
        error: { message: 'oops' },
      }),
    ).toBe(false);
  });

  it('rejects settings/changed with missing changes', () => {
    expect(isExtensionMessage({ type: 'settings/changed' })).toBe(false);
  });

  it('rejects settings/changed with null changes', () => {
    expect(
      isExtensionMessage({ type: 'settings/changed', changes: null }),
    ).toBe(false);
  });

  it('rejects rateLimit/warning with missing resetAt', () => {
    expect(isExtensionMessage({ type: 'rateLimit/warning' })).toBe(false);
  });

  it('rejects rateLimit/warning with string resetAt', () => {
    expect(
      isExtensionMessage({ type: 'rateLimit/warning', resetAt: 'not-a-number' }),
    ).toBe(false);
  });

  it('rejects extension/toggle with string enabled', () => {
    expect(
      isExtensionMessage({ type: 'extension/toggle', enabled: 'true' }),
    ).toBe(false);
  });

  it('rejects worker/status with missing fields', () => {
    expect(
      isExtensionMessage({ type: 'worker/status', language: 'typescript' }),
    ).toBe(false);
  });

  it('rejects page/navigated with undefined newContext', () => {
    expect(isExtensionMessage({ type: 'page/navigated' })).toBe(false);
  });

  it('rejects hover request with missing owner', () => {
    expect(
      isExtensionMessage({
        type: 'lsp/hover',
        requestId: 'abc',
        repo,
        ref,
        filePath,
        position,
      }),
    ).toBe(false);
  });
});

// ─── isLspRequest ───────────────────────────────────────────────────────────

describe('isLspRequest', () => {
  it('returns true for hover request', () => {
    const msg = createHoverRequest(owner, repo, ref, filePath, position);
    expect(isLspRequest(msg)).toBe(true);
  });

  it('returns true for definition request', () => {
    const msg = createDefinitionRequest(owner, repo, ref, filePath, position);
    expect(isLspRequest(msg)).toBe(true);
  });

  it('returns true for signatureHelp request', () => {
    const msg = createSignatureHelpRequest(
      owner,
      repo,
      ref,
      filePath,
      position,
    );
    expect(isLspRequest(msg)).toBe(true);
  });

  it('returns true for cancel request', () => {
    const msg = createCancelRequest('req-1');
    expect(isLspRequest(msg)).toBe(true);
  });

  it('returns false for hover response', () => {
    const msg = createHoverResponse('req-1', hoverResult);
    expect(isLspRequest(msg)).toBe(false);
  });

  it('returns false for error response', () => {
    const msg = createErrorResponse('req-1', extensionError);
    expect(isLspRequest(msg)).toBe(false);
  });

  it('returns false for notification messages', () => {
    const toggle: ExtensionMessage = { type: 'extension/toggle', enabled: true };
    expect(isLspRequest(toggle)).toBe(false);
  });
});

// ─── isLspResponse ──────────────────────────────────────────────────────────

describe('isLspResponse', () => {
  it('returns true for hover response', () => {
    const msg = createHoverResponse('req-1', hoverResult);
    expect(isLspResponse(msg)).toBe(true);
  });

  it('returns true for definition response', () => {
    const msg = createDefinitionResponse('req-1', definitionResult);
    expect(isLspResponse(msg)).toBe(true);
  });

  it('returns true for signatureHelp response', () => {
    const msg = createSignatureHelpResponse('req-1', signatureHelpResult);
    expect(isLspResponse(msg)).toBe(true);
  });

  it('returns true for error response', () => {
    const msg = createErrorResponse('req-1', extensionError);
    expect(isLspResponse(msg)).toBe(true);
  });

  it('returns false for hover request', () => {
    const msg = createHoverRequest(owner, repo, ref, filePath, position);
    expect(isLspResponse(msg)).toBe(false);
  });

  it('returns false for cancel request', () => {
    const msg = createCancelRequest('req-1');
    expect(isLspResponse(msg)).toBe(false);
  });

  it('returns false for notification messages', () => {
    const msg: ExtensionMessage = {
      type: 'worker/status',
      language: 'typescript',
      status: 'ready',
    };
    expect(isLspResponse(msg)).toBe(false);
  });
});

// ─── Round-trip integration ─────────────────────────────────────────────────

describe('round-trip message validation', () => {
  it('factory output always passes isExtensionMessage', () => {
    const messages: ExtensionMessage[] = [
      createHoverRequest(owner, repo, ref, filePath, position),
      createDefinitionRequest(owner, repo, ref, filePath, position),
      createSignatureHelpRequest(owner, repo, ref, filePath, position),
      createCancelRequest('cancel-me'),
      createHoverResponse('r1', hoverResult),
      createHoverResponse('r2', null),
      createDefinitionResponse('r3', definitionResult),
      createDefinitionResponse('r4', []),
      createSignatureHelpResponse('r5', signatureHelpResult),
      createSignatureHelpResponse('r6', null),
      createErrorResponse('r7', extensionError),
    ];

    for (const msg of messages) {
      expect(isExtensionMessage(msg)).toBe(true);
    }
  });

  it('request factories produce LSP requests', () => {
    expect(
      isLspRequest(createHoverRequest(owner, repo, ref, filePath, position)),
    ).toBe(true);
    expect(
      isLspRequest(
        createDefinitionRequest(owner, repo, ref, filePath, position),
      ),
    ).toBe(true);
    expect(
      isLspRequest(
        createSignatureHelpRequest(owner, repo, ref, filePath, position),
      ),
    ).toBe(true);
    expect(isLspRequest(createCancelRequest('id'))).toBe(true);
  });

  it('response factories produce LSP responses', () => {
    expect(isLspResponse(createHoverResponse('r', null))).toBe(true);
    expect(isLspResponse(createDefinitionResponse('r', []))).toBe(true);
    expect(isLspResponse(createSignatureHelpResponse('r', null))).toBe(true);
    expect(isLspResponse(createErrorResponse('r', extensionError))).toBe(true);
  });
});
