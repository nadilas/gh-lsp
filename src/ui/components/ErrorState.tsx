import type { FunctionComponent } from 'preact';
import type { ExtensionError } from '../../shared/types';

export interface ErrorStateProps {
  /** The error to display */
  error: ExtensionError;
  /** Called when the user clicks the retry button */
  onRetry?: () => void;
  /** Called when the user clicks the dismiss button */
  onDismiss: () => void;
}

/**
 * Error display with optional retry button.
 * - `unsupported_language` errors show only a dismiss button (no retry).
 * - Other errors show a retry button if `onRetry` is provided.
 */
export const ErrorState: FunctionComponent<ErrorStateProps> = ({
  error,
  onRetry,
  onDismiss,
}) => (
  <div class="gh-lsp-popover__error" role="alert">
    <span class="gh-lsp-popover__error-message">{error.message}</span>
    <div class="gh-lsp-popover__error-actions">
      {error.code !== 'unsupported_language' && onRetry && (
        <button
          class="gh-lsp-popover__retry-btn"
          onClick={onRetry}
          type="button"
          aria-label="Retry"
        >
          Retry
        </button>
      )}
      <button
        class="gh-lsp-popover__dismiss-btn"
        onClick={onDismiss}
        type="button"
        aria-label="Dismiss error"
      >
        Dismiss
      </button>
    </div>
  </div>
);
