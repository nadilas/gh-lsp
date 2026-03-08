import type {
  ExtensionMessage,
  LspPosition,
  LspHoverResponse,
  LspDefinitionResponse,
  LspSignatureHelpResponse,
  LspErrorResponse,
  RepoContext,
  RateLimitWarningMessage,
  WorkerStatusMessage,
  SettingsChangedMessage,
  ExtensionToggleMessage,
} from '@shared/types';
import {
  createHoverRequest,
  createDefinitionRequest,
  createSignatureHelpRequest,
  createCancelRequest,
  isExtensionMessage,
} from '@shared/messages';

// ─── Types ──────────────────────────────────────────────────────────────────

/** LSP response union — hover, definition, or signatureHelp */
export type LspResponse =
  | LspHoverResponse
  | LspDefinitionResponse
  | LspSignatureHelpResponse;

/** Callback for background-initiated notifications */
export interface NotificationHandlers {
  onRateLimitWarning?: (message: RateLimitWarningMessage) => void;
  onWorkerStatus?: (message: WorkerStatusMessage) => void;
  onSettingsChanged?: (message: SettingsChangedMessage) => void;
  onExtensionToggle?: (message: ExtensionToggleMessage) => void;
}

/** Pending request tracked for cancellation and timeout */
interface PendingRequest {
  resolve: (response: LspResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

// ─── ContentMessaging ───────────────────────────────────────────────────────

/**
 * Content-side messaging layer that wraps chrome.runtime.sendMessage for
 * type-safe LSP request/response handling. Tracks pending requests for
 * cancellation and timeout, and listens for background-initiated notifications.
 */
export class ContentMessaging {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly timeoutMs: number;
  private listenerCleanup: (() => void) | null = null;

  constructor(timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs;
  }

  /**
   * Sends a hover request to the background service worker and waits for
   * the LSP hover response. Rejects on timeout or LSP error.
   */
  sendHoverRequest(
    context: RepoContext,
    position: LspPosition,
  ): Promise<LspHoverResponse> {
    const message = createHoverRequest(
      context.owner,
      context.repo,
      context.ref,
      context.filePath,
      position,
    );
    return this.sendRequest<LspHoverResponse>(message);
  }

  /**
   * Sends a definition request to the background service worker and waits
   * for the LSP definition response. Rejects on timeout or LSP error.
   */
  sendDefinitionRequest(
    context: RepoContext,
    position: LspPosition,
  ): Promise<LspDefinitionResponse> {
    const message = createDefinitionRequest(
      context.owner,
      context.repo,
      context.ref,
      context.filePath,
      position,
    );
    return this.sendRequest<LspDefinitionResponse>(message);
  }

  /**
   * Sends a signature help request to the background service worker and
   * waits for the LSP signature help response. Rejects on timeout or error.
   */
  sendSignatureHelpRequest(
    context: RepoContext,
    position: LspPosition,
  ): Promise<LspSignatureHelpResponse> {
    const message = createSignatureHelpRequest(
      context.owner,
      context.repo,
      context.ref,
      context.filePath,
      position,
    );
    return this.sendRequest<LspSignatureHelpResponse>(message);
  }

  /**
   * Cancels a pending request by ID. Sends a cancel message to the background
   * and rejects the pending promise immediately.
   */
  cancelRequest(requestId: string): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;

    // Send cancel to background so it can abort the LSP request
    const cancelMessage = createCancelRequest(requestId);
    chrome.runtime.sendMessage(cancelMessage).catch(() => {
      // Fire-and-forget: if cancel fails, the request is already cleaned up
    });

    // Clean up locally
    clearTimeout(pending.timer);
    this.pending.delete(requestId);
    pending.reject(new Error(`Request ${requestId} cancelled`));
  }

  /**
   * Cancels all pending requests. Used on page navigation or extension
   * deactivation to avoid stale responses.
   */
  cancelAll(): void {
    for (const [requestId, pending] of this.pending) {
      const cancelMessage = createCancelRequest(requestId);
      chrome.runtime.sendMessage(cancelMessage).catch(() => {});
      clearTimeout(pending.timer);
      pending.reject(new Error(`Request ${requestId} cancelled`));
    }
    this.pending.clear();
  }

  /**
   * Starts listening for background-initiated messages (notifications).
   * Returns a cleanup function to stop listening.
   */
  startListening(handlers: NotificationHandlers): () => void {
    // Remove any previous listener
    this.stopListening();

    const listener = (message: unknown): void => {
      if (!isExtensionMessage(message)) return;

      switch (message.type) {
        case 'rateLimit/warning':
          handlers.onRateLimitWarning?.(message);
          break;
        case 'worker/status':
          handlers.onWorkerStatus?.(message);
          break;
        case 'settings/changed':
          handlers.onSettingsChanged?.(message);
          break;
        case 'extension/toggle':
          handlers.onExtensionToggle?.(message);
          break;
      }
    };

    chrome.runtime.onMessage.addListener(listener);

    const cleanup = () => {
      chrome.runtime.onMessage.removeListener(listener);
      this.listenerCleanup = null;
    };

    this.listenerCleanup = cleanup;
    return cleanup;
  }

  /**
   * Stops listening for background notifications if currently listening.
   */
  stopListening(): void {
    this.listenerCleanup?.();
  }

  /**
   * Returns the number of currently pending (in-flight) requests.
   */
  get pendingCount(): number {
    return this.pending.size;
  }

  /**
   * Cleans up all state — cancels pending requests and stops listening.
   */
  dispose(): void {
    this.cancelAll();
    this.stopListening();
  }

  // ─── Private helpers ────────────────────────────────────────────────────

  private sendRequest<T extends LspResponse>(
    message: ExtensionMessage & { requestId: string },
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const requestId = message.requestId;

      // Timeout timer
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(
          new Error(
            `Request ${requestId} timed out after ${this.timeoutMs}ms`,
          ),
        );
      }, this.timeoutMs);

      // Track pending request
      this.pending.set(requestId, {
        resolve: resolve as (response: LspResponse) => void,
        reject,
        timer,
      });

      // Send via chrome.runtime.sendMessage — response arrives in the
      // callback (Promise resolution in MV3)
      chrome.runtime
        .sendMessage(message)
        .then((response: unknown) => {
          // Clean up pending tracking
          const pending = this.pending.get(requestId);
          if (!pending) return; // Already cancelled or timed out

          clearTimeout(pending.timer);
          this.pending.delete(requestId);

          // Validate the response
          if (!isExtensionMessage(response)) {
            pending.reject(
              new Error(`Invalid response for request ${requestId}`),
            );
            return;
          }

          // Check for error response
          if (response.type === 'lsp/error') {
            const errorResponse = response as LspErrorResponse;
            const err = new Error(errorResponse.error.message);
            (err as Error & { code: string }).code = errorResponse.error.code;
            pending.reject(err);
            return;
          }

          // Success response
          if (response.type === 'lsp/response') {
            pending.resolve(response as T);
            return;
          }

          // Unexpected response type
          pending.reject(
            new Error(
              `Unexpected response type "${response.type}" for request ${requestId}`,
            ),
          );
        })
        .catch((error: unknown) => {
          const pending = this.pending.get(requestId);
          if (!pending) return; // Already cancelled or timed out

          clearTimeout(pending.timer);
          this.pending.delete(requestId);
          pending.reject(
            error instanceof Error
              ? error
              : new Error(String(error)),
          );
        });
    });
  }
}
