import type {
  JsonRpcRequest,
  JsonRpcNotification,
  JsonRpcSuccessResponse,
  JsonRpcErrorResponse,
  JsonRpcErrorObject,
} from '../shared/types';
import { LspErrorCode } from '../shared/types';

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: JsonRpcErrorObject) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * JSON-RPC 2.0 transport over postMessage.
 * Correlates outgoing requests with incoming responses via numeric IDs,
 * handles timeouts, and supports fire-and-forget notifications.
 */
export class JsonRpcTransport {
  private nextId = 1;
  private pendingRequests: Map<number | string, PendingRequest> = new Map();
  private readonly postMsg: (msg: unknown) => void;
  private readonly defaultTimeoutMs: number;

  constructor(
    postMessage: (msg: unknown) => void,
    defaultTimeoutMs = 30_000,
  ) {
    this.postMsg = postMessage;
    this.defaultTimeoutMs = defaultTimeoutMs;
  }

  /**
   * Sends a JSON-RPC request and returns a promise that resolves when
   * the correlated response arrives.
   */
  sendRequest<T>(
    method: string,
    params?: unknown,
    timeoutMs?: number,
  ): Promise<T> {
    const id = this.nextId++;
    const request = createJsonRpcRequest(id, method, params);

    return new Promise<T>((resolve, reject) => {
      const timeout = timeoutMs ?? this.defaultTimeoutMs;
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject({
          code: LspErrorCode.RequestCancelled,
          message: `Request ${method} (id=${id}) timed out after ${timeout}ms`,
        } satisfies JsonRpcErrorObject);
      }, timeout);

      this.pendingRequests.set(id, {
        resolve: resolve as (result: unknown) => void,
        reject,
        timer,
      });

      this.postMsg(request);
    });
  }

  /**
   * Sends a notification (no response expected, no pending tracking).
   */
  sendNotification(method: string, params?: unknown): void {
    const notification = createJsonRpcNotification(method, params);
    this.postMsg(notification);
  }

  /**
   * Processes an incoming message. If it's a response (has `id` + `result` or `error`),
   * resolves or rejects the matching pending request.
   */
  handleMessage(data: unknown): void {
    if (!data || typeof data !== 'object') {
      return;
    }

    const msg = data as Record<string, unknown>;

    // Only handle response-like messages (must have an `id`)
    if (!('id' in msg)) {
      return;
    }

    const id = msg['id'] as number | string;
    const pending = this.pendingRequests.get(id);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timer);
    this.pendingRequests.delete(id);

    if ('error' in msg && msg['error']) {
      pending.reject(msg['error'] as JsonRpcErrorObject);
    } else if ('result' in msg) {
      pending.resolve(msg['result']);
    }
  }

  /**
   * Cancels a pending request by sending `$/cancelRequest` notification
   * and rejecting the pending promise.
   */
  cancelRequest(id: number | string): void {
    const pending = this.pendingRequests.get(id);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timer);
    this.pendingRequests.delete(id);

    // Send cancel notification to the server
    this.sendNotification('$/cancelRequest', { id });

    pending.reject({
      code: LspErrorCode.RequestCancelled,
      message: `Request (id=${id}) was cancelled`,
    });
  }

  /**
   * Returns the number of pending requests.
   */
  get pendingCount(): number {
    return this.pendingRequests.size;
  }

  /**
   * Rejects and clears all pending requests.
   */
  dispose(): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject({
        code: LspErrorCode.RequestCancelled,
        message: `Transport disposed, request (id=${id}) cancelled`,
      });
    }
    this.pendingRequests.clear();
  }
}

// ─── Type Guards ────────────────────────────────────────────────────────────

export function isJsonRpcRequest(msg: unknown): msg is JsonRpcRequest {
  if (!msg || typeof msg !== 'object') return false;
  const m = msg as Record<string, unknown>;
  return (
    m['jsonrpc'] === '2.0' &&
    'id' in m &&
    (typeof m['id'] === 'number' || typeof m['id'] === 'string') &&
    typeof m['method'] === 'string'
  );
}

export function isJsonRpcNotification(msg: unknown): msg is JsonRpcNotification {
  if (!msg || typeof msg !== 'object') return false;
  const m = msg as Record<string, unknown>;
  return (
    m['jsonrpc'] === '2.0' &&
    !('id' in m) &&
    typeof m['method'] === 'string'
  );
}

export function isJsonRpcResponse(
  msg: unknown,
): msg is JsonRpcSuccessResponse | JsonRpcErrorResponse {
  if (!msg || typeof msg !== 'object') return false;
  const m = msg as Record<string, unknown>;
  return (
    m['jsonrpc'] === '2.0' &&
    'id' in m &&
    ('result' in m || 'error' in m)
  );
}

// ─── Factories ──────────────────────────────────────────────────────────────

export function createJsonRpcRequest(
  id: number | string,
  method: string,
  params?: unknown,
): JsonRpcRequest {
  const req: JsonRpcRequest = { jsonrpc: '2.0', id, method };
  if (params !== undefined) {
    req.params = params;
  }
  return req;
}

export function createJsonRpcNotification(
  method: string,
  params?: unknown,
): JsonRpcNotification {
  const notif: JsonRpcNotification = { jsonrpc: '2.0', method };
  if (params !== undefined) {
    notif.params = params;
  }
  return notif;
}

export function createJsonRpcSuccessResponse(
  id: number | string,
  result: unknown,
): JsonRpcSuccessResponse {
  return { jsonrpc: '2.0', id, result };
}

export function createJsonRpcErrorResponse(
  id: number | string | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcErrorResponse {
  const resp: JsonRpcErrorResponse = {
    jsonrpc: '2.0',
    id,
    error: { code, message },
  };
  if (data !== undefined) {
    resp.error.data = data;
  }
  return resp;
}
