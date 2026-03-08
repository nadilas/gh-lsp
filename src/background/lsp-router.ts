import type {
  ExtensionMessage,
  ExtensionSettings,
  LspHoverRequest,
  LspHoverResponse,
  LspDefinitionRequest,
  LspDefinitionResponse,
  LspSignatureHelpRequest,
  LspSignatureHelpResponse,
  LspCancelRequest,
  LspErrorResponse,
  LspHover,
  LspLocation,
  LspSignatureHelp,
} from '../shared/types';
import { getLanguageForFilePath } from '../shared/languages';
import { getCapabilities } from '../workers/language-registry';
import { createErrorResponse } from '../shared/messages';
import type { WorkerPool } from './worker-pool';
import type { DocumentSync } from './document-sync';
import type { LruCache } from './cache';
import { buildFileUri } from './document-sync';

/**
 * Top-level LSP request handler that ties together language detection,
 * document sync, worker pool, caching, and response forwarding.
 */
export class LspRouter {
  private readonly workerPool: WorkerPool;
  private readonly documentSync: DocumentSync;
  private readonly responseCache: LruCache<unknown>;
  private readonly getSettings: () => Promise<ExtensionSettings>;

  constructor(
    workerPool: WorkerPool,
    documentSync: DocumentSync,
    responseCache: LruCache<unknown>,
    getSettings: () => Promise<ExtensionSettings>,
  ) {
    this.workerPool = workerPool;
    this.documentSync = documentSync;
    this.responseCache = responseCache;
    this.getSettings = getSettings;
  }

  /**
   * Dispatches an incoming LSP request to the appropriate handler.
   */
  async handleRequest(
    message: ExtensionMessage,
  ): Promise<ExtensionMessage> {
    switch (message.type) {
      case 'lsp/hover':
        return this.handleHover(message);
      case 'lsp/definition':
        return this.handleDefinition(message);
      case 'lsp/signatureHelp':
        return this.handleSignatureHelp(message);
      case 'lsp/cancel':
        this.handleCancel(message);
        // Cancel doesn't produce a response message
        return createErrorResponse(message.requestId, {
          code: 'lsp_server_error',
          message: 'Request cancelled',
        });
      default:
        return createErrorResponse('unknown', {
          code: 'lsp_server_error',
          message: `Unknown message type`,
        });
    }
  }

  private async handleHover(
    request: LspHoverRequest,
  ): Promise<LspHoverResponse | LspErrorResponse> {
    const languageCheck = await this.validateLanguage(
      request.filePath,
      request.requestId,
    );
    if ('error' in languageCheck) {
      return languageCheck.error;
    }
    const { language } = languageCheck;

    // Check capabilities
    const caps = getCapabilities(language);
    if (!caps.hoverProvider) {
      return createErrorResponse(request.requestId, {
        code: 'unsupported_language',
        message: `Hover not supported for ${language}`,
        language,
      });
    }

    // Check cache
    const cacheKey = buildCacheKey(request);
    const cached = this.responseCache.get(cacheKey) as LspHover | null | undefined;
    if (cached !== null && cached !== undefined) {
      return {
        type: 'lsp/response',
        requestId: request.requestId,
        kind: 'hover',
        result: cached,
      };
    }

    try {
      const managed = await this.workerPool.getOrCreateWorker(language);

      // Ensure document is open
      await this.documentSync.ensureDocumentOpen(
        managed.id,
        request.owner,
        request.repo,
        request.ref,
        request.filePath,
        (uri, content, languageId) => {
          managed.transport.sendNotification('textDocument/didOpen', {
            textDocument: { uri, languageId, version: 1, text: content },
          });
        },
      );

      // Send hover request
      const uri = buildFileUri(
        request.owner,
        request.repo,
        request.ref,
        request.filePath,
      );
      const result = await managed.transport.sendRequest<LspHover | null>(
        'textDocument/hover',
        {
          textDocument: { uri },
          position: request.position,
        },
      );

      // Cache result
      if (result !== null) {
        this.responseCache.set(cacheKey, result);
      }

      // Start idle timer
      this.workerPool.startIdleTimer(language);

      return {
        type: 'lsp/response',
        requestId: request.requestId,
        kind: 'hover',
        result,
      };
    } catch (error) {
      return createErrorResponse(request.requestId, {
        code: 'lsp_server_error',
        message: error instanceof Error ? error.message : 'Hover request failed',
        language,
      });
    }
  }

  private async handleDefinition(
    request: LspDefinitionRequest,
  ): Promise<LspDefinitionResponse | LspErrorResponse> {
    const languageCheck = await this.validateLanguage(
      request.filePath,
      request.requestId,
    );
    if ('error' in languageCheck) {
      return languageCheck.error;
    }
    const { language } = languageCheck;

    const caps = getCapabilities(language);
    if (!caps.definitionProvider) {
      return createErrorResponse(request.requestId, {
        code: 'unsupported_language',
        message: `Definition not supported for ${language}`,
        language,
      });
    }

    // Check cache
    const cacheKey = buildCacheKey(request);
    const cached = this.responseCache.get(cacheKey) as LspLocation[] | undefined;
    if (cached !== null && cached !== undefined) {
      return {
        type: 'lsp/response',
        requestId: request.requestId,
        kind: 'definition',
        result: cached,
      };
    }

    try {
      const managed = await this.workerPool.getOrCreateWorker(language);

      await this.documentSync.ensureDocumentOpen(
        managed.id,
        request.owner,
        request.repo,
        request.ref,
        request.filePath,
        (uri, content, languageId) => {
          managed.transport.sendNotification('textDocument/didOpen', {
            textDocument: { uri, languageId, version: 1, text: content },
          });
        },
      );

      const uri = buildFileUri(
        request.owner,
        request.repo,
        request.ref,
        request.filePath,
      );
      const result = await managed.transport.sendRequest<LspLocation[]>(
        'textDocument/definition',
        {
          textDocument: { uri },
          position: request.position,
        },
      );

      if (result && result.length > 0) {
        this.responseCache.set(cacheKey, result);
      }

      this.workerPool.startIdleTimer(language);

      return {
        type: 'lsp/response',
        requestId: request.requestId,
        kind: 'definition',
        result: result ?? [],
      };
    } catch (error) {
      return createErrorResponse(request.requestId, {
        code: 'lsp_server_error',
        message: error instanceof Error ? error.message : 'Definition request failed',
        language,
      });
    }
  }

  private async handleSignatureHelp(
    request: LspSignatureHelpRequest,
  ): Promise<LspSignatureHelpResponse | LspErrorResponse> {
    const languageCheck = await this.validateLanguage(
      request.filePath,
      request.requestId,
    );
    if ('error' in languageCheck) {
      return languageCheck.error;
    }
    const { language } = languageCheck;

    const caps = getCapabilities(language);
    if (!caps.signatureHelpProvider) {
      return createErrorResponse(request.requestId, {
        code: 'unsupported_language',
        message: `Signature help not supported for ${language}`,
        language,
      });
    }

    try {
      const managed = await this.workerPool.getOrCreateWorker(language);

      await this.documentSync.ensureDocumentOpen(
        managed.id,
        request.owner,
        request.repo,
        request.ref,
        request.filePath,
        (uri, content, languageId) => {
          managed.transport.sendNotification('textDocument/didOpen', {
            textDocument: { uri, languageId, version: 1, text: content },
          });
        },
      );

      const uri = buildFileUri(
        request.owner,
        request.repo,
        request.ref,
        request.filePath,
      );
      const result = await managed.transport.sendRequest<LspSignatureHelp | null>(
        'textDocument/signatureHelp',
        {
          textDocument: { uri },
          position: request.position,
        },
      );

      this.workerPool.startIdleTimer(language);

      return {
        type: 'lsp/response',
        requestId: request.requestId,
        kind: 'signatureHelp',
        result,
      };
    } catch (error) {
      return createErrorResponse(request.requestId, {
        code: 'lsp_server_error',
        message: error instanceof Error ? error.message : 'Signature help request failed',
        language,
      });
    }
  }

  private handleCancel(_request: LspCancelRequest): void {
    // The requestId from the cancel message refers to the request we need to cancel.
    // We can't directly map requestId to a worker's internal JSON-RPC ID here,
    // but we can attempt to cancel on all workers that might be processing it.
    // In practice, only one worker would be handling it.
    // For now, this is a best-effort cancellation.
  }

  /**
   * Validates that the file's language is supported and enabled.
   * Returns the language or an error response.
   */
  private async validateLanguage(
    filePath: string,
    requestId: string,
  ): Promise<
    | { language: string & import('../shared/types').SupportedLanguage }
    | { error: LspErrorResponse }
  > {
    const language = getLanguageForFilePath(filePath);
    if (!language) {
      return {
        error: createErrorResponse(requestId, {
          code: 'unsupported_language',
          message: `Unsupported file type: ${filePath}`,
        }),
      };
    }

    const settings = await this.getSettings();
    if (!settings.enabledLanguages.includes(language)) {
      return {
        error: createErrorResponse(requestId, {
          code: 'unsupported_language',
          message: `Language ${language} is disabled`,
          language,
        }),
      };
    }

    return { language };
  }
}

/**
 * Builds a cache key for an LSP request.
 * Format: {owner}/{repo}/{ref}/{filePath}:{line}:{character}:{kind}
 */
function buildCacheKey(
  request: LspHoverRequest | LspDefinitionRequest | LspSignatureHelpRequest,
): string {
  return `${request.owner}/${request.repo}/${request.ref}/${request.filePath}:${request.position.line}:${request.position.character}:${request.type}`;
}
