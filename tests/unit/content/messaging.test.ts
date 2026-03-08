import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ContentMessaging } from '../../../src/content/messaging';
import type {
  RepoContext,
  LspPosition,
  LspHoverResponse,
  LspDefinitionResponse,
  LspSignatureHelpResponse,
  LspErrorResponse,
  RateLimitWarningMessage,
  WorkerStatusMessage,
  SettingsChangedMessage,
  ExtensionToggleMessage,
} from '../../../src/shared/types';

// ─── Chrome API mock ────────────────────────────────────────────────────────

type MessageListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
) => void;

let messageListeners: MessageListener[] = [];
let sendMessageMock: ReturnType<typeof vi.fn>;

function setupChromeMock() {
  messageListeners = [];
  sendMessageMock = vi.fn();

  const chromeMock = {
    runtime: {
      sendMessage: sendMessageMock,
      onMessage: {
        addListener: vi.fn((listener: MessageListener) => {
          messageListeners.push(listener);
        }),
        removeListener: vi.fn((listener: MessageListener) => {
          messageListeners = messageListeners.filter((l) => l !== listener);
        }),
      },
    },
  };

  vi.stubGlobal('chrome', chromeMock);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const TEST_CONTEXT: RepoContext = {
  owner: 'testowner',
  repo: 'testrepo',
  ref: 'main',
  filePath: 'src/index.ts',
  language: 'typescript',
};

const TEST_POSITION: LspPosition = { line: 5, character: 10 };

function createHoverResponsePayload(requestId: string): LspHoverResponse {
  return {
    type: 'lsp/response',
    requestId,
    kind: 'hover',
    result: {
      contents: { kind: 'markdown', value: '```ts\nconst x: number\n```' },
    },
  };
}

function createDefinitionResponsePayload(
  requestId: string,
): LspDefinitionResponse {
  return {
    type: 'lsp/response',
    requestId,
    kind: 'definition',
    result: [
      {
        uri: 'gh-lsp://testowner/testrepo/main/src/types.ts',
        range: {
          start: { line: 10, character: 0 },
          end: { line: 10, character: 15 },
        },
      },
    ],
  };
}

function createSignatureHelpResponsePayload(
  requestId: string,
): LspSignatureHelpResponse {
  return {
    type: 'lsp/response',
    requestId,
    kind: 'signatureHelp',
    result: {
      signatures: [
        {
          label: 'fn(x: number): void',
          parameters: [{ label: 'x: number' }],
        },
      ],
      activeSignature: 0,
      activeParameter: 0,
    },
  };
}

function createErrorResponsePayload(requestId: string): LspErrorResponse {
  return {
    type: 'lsp/error',
    requestId,
    error: {
      code: 'lsp_server_error',
      message: 'Internal server error',
    },
  };
}

/** Simulates a background notification arriving via chrome.runtime.onMessage */
function simulateBackgroundMessage(message: unknown): void {
  for (const listener of messageListeners) {
    listener(message, {} as chrome.runtime.MessageSender, vi.fn());
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('ContentMessaging', () => {
  let messaging: ContentMessaging;

  beforeEach(() => {
    vi.useFakeTimers();
    setupChromeMock();
    messaging = new ContentMessaging(5000); // 5s timeout
  });

  afterEach(() => {
    messaging.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ─── Hover requests ─────────────────────────────────────────────────────

  describe('sendHoverRequest', () => {
    it('sends a correctly formed hover request and resolves with the response', async () => {
      sendMessageMock.mockImplementation((message: { requestId: string }) => {
        return Promise.resolve(createHoverResponsePayload(message.requestId));
      });

      const result = await messaging.sendHoverRequest(
        TEST_CONTEXT,
        TEST_POSITION,
      );

      expect(sendMessageMock).toHaveBeenCalledOnce();
      const sentMessage = sendMessageMock.mock.calls[0]![0];
      expect(sentMessage.type).toBe('lsp/hover');
      expect(sentMessage.owner).toBe('testowner');
      expect(sentMessage.repo).toBe('testrepo');
      expect(sentMessage.ref).toBe('main');
      expect(sentMessage.filePath).toBe('src/index.ts');
      expect(sentMessage.position).toEqual({ line: 5, character: 10 });
      expect(sentMessage.requestId).toBeDefined();
      expect(typeof sentMessage.requestId).toBe('string');

      expect(result.type).toBe('lsp/response');
      expect(result.kind).toBe('hover');
      expect(result.result).toBeDefined();
    });

    it('has zero pending requests after resolution', async () => {
      sendMessageMock.mockImplementation((message: { requestId: string }) => {
        return Promise.resolve(createHoverResponsePayload(message.requestId));
      });

      await messaging.sendHoverRequest(TEST_CONTEXT, TEST_POSITION);
      expect(messaging.pendingCount).toBe(0);
    });
  });

  // ─── Definition requests ────────────────────────────────────────────────

  describe('sendDefinitionRequest', () => {
    it('sends a correctly formed definition request and resolves', async () => {
      sendMessageMock.mockImplementation((message: { requestId: string }) => {
        return Promise.resolve(
          createDefinitionResponsePayload(message.requestId),
        );
      });

      const result = await messaging.sendDefinitionRequest(
        TEST_CONTEXT,
        TEST_POSITION,
      );

      const sentMessage = sendMessageMock.mock.calls[0]![0];
      expect(sentMessage.type).toBe('lsp/definition');
      expect(result.kind).toBe('definition');
      expect(result.result).toHaveLength(1);
    });
  });

  // ─── Signature help requests ────────────────────────────────────────────

  describe('sendSignatureHelpRequest', () => {
    it('sends a correctly formed signatureHelp request and resolves', async () => {
      sendMessageMock.mockImplementation((message: { requestId: string }) => {
        return Promise.resolve(
          createSignatureHelpResponsePayload(message.requestId),
        );
      });

      const result = await messaging.sendSignatureHelpRequest(
        TEST_CONTEXT,
        TEST_POSITION,
      );

      const sentMessage = sendMessageMock.mock.calls[0]![0];
      expect(sentMessage.type).toBe('lsp/signatureHelp');
      expect(result.kind).toBe('signatureHelp');
      expect(result.result?.signatures).toHaveLength(1);
    });
  });

  // ─── Error handling ─────────────────────────────────────────────────────

  describe('error handling', () => {
    it('rejects with error code and message when receiving lsp/error response', async () => {
      sendMessageMock.mockImplementation((message: { requestId: string }) => {
        return Promise.resolve(createErrorResponsePayload(message.requestId));
      });

      await expect(
        messaging.sendHoverRequest(TEST_CONTEXT, TEST_POSITION),
      ).rejects.toThrow('Internal server error');

      try {
        await messaging.sendHoverRequest(TEST_CONTEXT, TEST_POSITION);
      } catch (err) {
        expect((err as Error & { code: string }).code).toBe(
          'lsp_server_error',
        );
      }
    });

    it('rejects when chrome.runtime.sendMessage fails', async () => {
      sendMessageMock.mockRejectedValue(new Error('Extension context invalid'));

      await expect(
        messaging.sendHoverRequest(TEST_CONTEXT, TEST_POSITION),
      ).rejects.toThrow('Extension context invalid');
    });

    it('rejects with wrapped error for non-Error rejections', async () => {
      sendMessageMock.mockRejectedValue('string error');

      await expect(
        messaging.sendHoverRequest(TEST_CONTEXT, TEST_POSITION),
      ).rejects.toThrow('string error');
    });

    it('rejects when response is not a valid ExtensionMessage', async () => {
      sendMessageMock.mockResolvedValue({ invalid: true });

      await expect(
        messaging.sendHoverRequest(TEST_CONTEXT, TEST_POSITION),
      ).rejects.toThrow('Invalid response');
    });

    it('rejects when response has unexpected type', async () => {
      sendMessageMock.mockResolvedValue({
        type: 'settings/changed',
        changes: {},
      });

      await expect(
        messaging.sendHoverRequest(TEST_CONTEXT, TEST_POSITION),
      ).rejects.toThrow('Unexpected response type');
    });
  });

  // ─── Timeout handling ───────────────────────────────────────────────────

  describe('timeout', () => {
    it('rejects after the configured timeout period', async () => {
      // Never resolve the sendMessage promise
      sendMessageMock.mockReturnValue(new Promise(() => {}));

      const promise = messaging.sendHoverRequest(TEST_CONTEXT, TEST_POSITION);
      expect(messaging.pendingCount).toBe(1);

      // Advance past timeout
      vi.advanceTimersByTime(5001);

      await expect(promise).rejects.toThrow('timed out after 5000ms');
      expect(messaging.pendingCount).toBe(0);
    });

    it('uses the default 10s timeout when not configured', async () => {
      const defaultMessaging = new ContentMessaging();
      sendMessageMock.mockReturnValue(new Promise(() => {}));

      const promise = defaultMessaging.sendHoverRequest(
        TEST_CONTEXT,
        TEST_POSITION,
      );

      // Advance 9.9s — should not reject yet
      vi.advanceTimersByTime(9900);
      expect(defaultMessaging.pendingCount).toBe(1);

      // Advance past 10s — should reject
      vi.advanceTimersByTime(200);
      await expect(promise).rejects.toThrow('timed out after 10000ms');

      defaultMessaging.dispose();
    });
  });

  // ─── Cancel handling ────────────────────────────────────────────────────

  describe('cancelRequest', () => {
    it('cancels a pending request and sends cancel message to background', async () => {
      sendMessageMock.mockReturnValue(new Promise(() => {}));

      const promise = messaging.sendHoverRequest(TEST_CONTEXT, TEST_POSITION);
      expect(messaging.pendingCount).toBe(1);

      const requestId = sendMessageMock.mock.calls[0]![0].requestId;

      // Cancel it
      messaging.cancelRequest(requestId);

      expect(messaging.pendingCount).toBe(0);

      // Should have sent a cancel message
      expect(sendMessageMock).toHaveBeenCalledTimes(2);
      const cancelMessage = sendMessageMock.mock.calls[1]![0];
      expect(cancelMessage.type).toBe('lsp/cancel');
      expect(cancelMessage.requestId).toBe(requestId);

      // Promise should reject
      await expect(promise).rejects.toThrow('cancelled');
    });

    it('does nothing when cancelling a non-existent request', () => {
      messaging.cancelRequest('nonexistent-id');
      expect(sendMessageMock).not.toHaveBeenCalled();
    });

    it('ignores if cancel message send fails', async () => {
      sendMessageMock
        .mockReturnValueOnce(new Promise(() => {})) // original request
        .mockRejectedValueOnce(new Error('send failed')); // cancel

      const promise = messaging.sendHoverRequest(TEST_CONTEXT, TEST_POSITION);
      const requestId = sendMessageMock.mock.calls[0]![0].requestId;

      // Should not throw
      expect(() => messaging.cancelRequest(requestId)).not.toThrow();

      // Ensure the rejection is handled
      await expect(promise).rejects.toThrow('cancelled');
    });
  });

  // ─── Cancel all ─────────────────────────────────────────────────────────

  describe('cancelAll', () => {
    it('cancels all pending requests', async () => {
      sendMessageMock.mockReturnValue(new Promise(() => {}));

      const p1 = messaging.sendHoverRequest(TEST_CONTEXT, TEST_POSITION);
      const p2 = messaging.sendDefinitionRequest(TEST_CONTEXT, TEST_POSITION);
      const p3 = messaging.sendSignatureHelpRequest(
        TEST_CONTEXT,
        TEST_POSITION,
      );

      expect(messaging.pendingCount).toBe(3);

      messaging.cancelAll();
      expect(messaging.pendingCount).toBe(0);

      // All promises should reject
      await expect(p1).rejects.toThrow('cancelled');
      await expect(p2).rejects.toThrow('cancelled');
      await expect(p3).rejects.toThrow('cancelled');

      // Should have sent 3 original + 3 cancel messages
      expect(sendMessageMock).toHaveBeenCalledTimes(6);
    });
  });

  // ─── Notification listening ─────────────────────────────────────────────

  describe('startListening', () => {
    it('registers a chrome.runtime.onMessage listener', () => {
      messaging.startListening({});
      expect(chrome.runtime.onMessage.addListener).toHaveBeenCalledOnce();
    });

    it('calls onRateLimitWarning handler for rateLimit/warning messages', () => {
      const onRateLimitWarning = vi.fn();
      messaging.startListening({ onRateLimitWarning });

      const message: RateLimitWarningMessage = {
        type: 'rateLimit/warning',
        resetAt: Date.now() + 60000,
      };

      simulateBackgroundMessage(message);
      expect(onRateLimitWarning).toHaveBeenCalledOnce();
      expect(onRateLimitWarning).toHaveBeenCalledWith(message);
    });

    it('calls onWorkerStatus handler for worker/status messages', () => {
      const onWorkerStatus = vi.fn();
      messaging.startListening({ onWorkerStatus });

      const message: WorkerStatusMessage = {
        type: 'worker/status',
        language: 'typescript',
        status: 'ready',
      };

      simulateBackgroundMessage(message);
      expect(onWorkerStatus).toHaveBeenCalledOnce();
      expect(onWorkerStatus).toHaveBeenCalledWith(message);
    });

    it('calls onSettingsChanged handler for settings/changed messages', () => {
      const onSettingsChanged = vi.fn();
      messaging.startListening({ onSettingsChanged });

      const message: SettingsChangedMessage = {
        type: 'settings/changed',
        changes: { enabled: false },
      };

      simulateBackgroundMessage(message);
      expect(onSettingsChanged).toHaveBeenCalledOnce();
      expect(onSettingsChanged).toHaveBeenCalledWith(message);
    });

    it('calls onExtensionToggle handler for extension/toggle messages', () => {
      const onExtensionToggle = vi.fn();
      messaging.startListening({ onExtensionToggle });

      const message: ExtensionToggleMessage = {
        type: 'extension/toggle',
        enabled: false,
      };

      simulateBackgroundMessage(message);
      expect(onExtensionToggle).toHaveBeenCalledOnce();
      expect(onExtensionToggle).toHaveBeenCalledWith(message);
    });

    it('ignores non-ExtensionMessage values', () => {
      const onWorkerStatus = vi.fn();
      messaging.startListening({ onWorkerStatus });

      simulateBackgroundMessage({ notAValidMessage: true });
      simulateBackgroundMessage(null);
      simulateBackgroundMessage('string');
      simulateBackgroundMessage(42);

      expect(onWorkerStatus).not.toHaveBeenCalled();
    });

    it('ignores LSP request/response messages (they are not notifications)', () => {
      const onRateLimitWarning = vi.fn();
      const onWorkerStatus = vi.fn();
      messaging.startListening({ onRateLimitWarning, onWorkerStatus });

      // These are valid ExtensionMessages but not notification types
      simulateBackgroundMessage({
        type: 'lsp/hover',
        requestId: 'test',
        owner: 'o',
        repo: 'r',
        ref: 'ref',
        filePath: 'f.ts',
        position: { line: 0, character: 0 },
      });

      simulateBackgroundMessage({
        type: 'lsp/response',
        requestId: 'test',
        kind: 'hover',
        result: null,
      });

      expect(onRateLimitWarning).not.toHaveBeenCalled();
      expect(onWorkerStatus).not.toHaveBeenCalled();
    });

    it('removes previous listener when startListening is called again', () => {
      messaging.startListening({});
      messaging.startListening({});

      expect(chrome.runtime.onMessage.removeListener).toHaveBeenCalledOnce();
      expect(chrome.runtime.onMessage.addListener).toHaveBeenCalledTimes(2);
    });

    it('returns a cleanup function that removes the listener', () => {
      const cleanup = messaging.startListening({});
      cleanup();

      expect(chrome.runtime.onMessage.removeListener).toHaveBeenCalledOnce();
    });
  });

  // ─── stopListening ──────────────────────────────────────────────────────

  describe('stopListening', () => {
    it('removes the current listener', () => {
      messaging.startListening({});
      messaging.stopListening();

      expect(chrome.runtime.onMessage.removeListener).toHaveBeenCalledOnce();
    });

    it('does nothing if no listener is active', () => {
      messaging.stopListening();
      expect(chrome.runtime.onMessage.removeListener).not.toHaveBeenCalled();
    });
  });

  // ─── dispose ────────────────────────────────────────────────────────────

  describe('dispose', () => {
    it('cancels all pending requests and stops listening', async () => {
      sendMessageMock.mockReturnValue(new Promise(() => {}));

      messaging.startListening({});
      const promise = messaging.sendHoverRequest(TEST_CONTEXT, TEST_POSITION);
      expect(messaging.pendingCount).toBe(1);

      messaging.dispose();

      expect(messaging.pendingCount).toBe(0);
      expect(chrome.runtime.onMessage.removeListener).toHaveBeenCalledOnce();

      await expect(promise).rejects.toThrow('cancelled');
    });
  });

  // ─── Concurrent requests ────────────────────────────────────────────────

  describe('concurrent requests', () => {
    it('tracks multiple pending requests independently', async () => {
      const responses = new Map<string, (value: unknown) => void>();

      sendMessageMock.mockImplementation((message: { requestId: string }) => {
        return new Promise((resolve) => {
          responses.set(message.requestId, resolve);
        });
      });

      const p1 = messaging.sendHoverRequest(TEST_CONTEXT, TEST_POSITION);
      const p2 = messaging.sendDefinitionRequest(TEST_CONTEXT, TEST_POSITION);

      expect(messaging.pendingCount).toBe(2);

      // Resolve first request
      const firstId = sendMessageMock.mock.calls[0]![0].requestId;
      responses.get(firstId)!(createHoverResponsePayload(firstId));
      await p1;

      expect(messaging.pendingCount).toBe(1);

      // Resolve second request
      const secondId = sendMessageMock.mock.calls[1]![0].requestId;
      responses.get(secondId)!(createDefinitionResponsePayload(secondId));
      await p2;

      expect(messaging.pendingCount).toBe(0);
    });

    it('generates unique request IDs for each request', async () => {
      sendMessageMock.mockReturnValue(new Promise(() => {}));

      const p1 = messaging.sendHoverRequest(TEST_CONTEXT, TEST_POSITION);
      const p2 = messaging.sendHoverRequest(TEST_CONTEXT, TEST_POSITION);
      const p3 = messaging.sendHoverRequest(TEST_CONTEXT, TEST_POSITION);

      const ids = sendMessageMock.mock.calls.map(
        (call: unknown[]) => (call[0] as { requestId: string }).requestId,
      );
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(3);

      // Clean up pending promises
      messaging.cancelAll();
      await expect(p1).rejects.toThrow('cancelled');
      await expect(p2).rejects.toThrow('cancelled');
      await expect(p3).rejects.toThrow('cancelled');
    });
  });

  // ─── Edge cases ─────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('ignores response arriving after timeout', async () => {
      let resolveExternal: ((value: unknown) => void) | undefined;
      sendMessageMock.mockImplementation(() => {
        return new Promise((resolve) => {
          resolveExternal = resolve;
        });
      });

      const promise = messaging.sendHoverRequest(TEST_CONTEXT, TEST_POSITION);

      // Advance past timeout
      vi.advanceTimersByTime(5001);
      await expect(promise).rejects.toThrow('timed out');

      // Now resolve (after timeout) — should not throw
      const requestId = sendMessageMock.mock.calls[0]![0].requestId;
      expect(() =>
        resolveExternal!(createHoverResponsePayload(requestId)),
      ).not.toThrow();
    });

    it('ignores response arriving after cancel', async () => {
      let resolveExternal: ((value: unknown) => void) | undefined;
      sendMessageMock.mockImplementation(
        (message: { requestId: string; type: string }) => {
          if (message.type === 'lsp/cancel') {
            return Promise.resolve();
          }
          return new Promise((resolve) => {
            resolveExternal = resolve;
          });
        },
      );

      const promise = messaging.sendHoverRequest(TEST_CONTEXT, TEST_POSITION);
      const requestId = sendMessageMock.mock.calls[0]![0].requestId;

      messaging.cancelRequest(requestId);
      await expect(promise).rejects.toThrow('cancelled');

      // Now resolve (after cancel) — should not throw
      expect(() =>
        resolveExternal!(createHoverResponsePayload(requestId)),
      ).not.toThrow();
    });
  });
});
