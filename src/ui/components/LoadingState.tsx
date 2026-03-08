import { type FunctionComponent } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { LOADING_INDICATOR_DELAY_MS } from '../../shared/constants';

export interface LoadingStateProps {
  /** Delay in ms before showing the skeleton (defaults to LOADING_INDICATOR_DELAY_MS = 200ms) */
  delayMs?: number;
}

/**
 * Pulsing skeleton UI shown during LSP request loading.
 * Delays rendering by 200ms to avoid flicker on fast responses.
 */
export const LoadingState: FunctionComponent<LoadingStateProps> = ({
  delayMs = LOADING_INDICATOR_DELAY_MS,
}) => {
  const [visible, setVisible] = useState(delayMs <= 0);

  useEffect(() => {
    if (delayMs <= 0) {
      setVisible(true);
      return;
    }

    const timer = setTimeout(() => {
      setVisible(true);
    }, delayMs);

    return () => clearTimeout(timer);
  }, [delayMs]);

  if (!visible) {
    return null;
  }

  return (
    <div class="gh-lsp-popover__loading" role="status" aria-label="Loading type information" aria-busy="true">
      <div class="gh-lsp-popover__skeleton gh-lsp-popover__skeleton--line" />
      <div class="gh-lsp-popover__skeleton gh-lsp-popover__skeleton--line gh-lsp-popover__skeleton--short" />
    </div>
  );
};
