import { type FunctionComponent } from 'preact';
import { useEffect, useRef, useCallback, useState } from 'preact/hooks';
import type {
  PopoverState,
  PopoverPosition,
  HoverDisplayData,
  ExtensionError,
} from '../../shared/types';
import {
  POPOVER_FADE_DURATION_MS,
  MAX_POPOVER_HEIGHT_PX,
  SCROLL_DISMISS_THRESHOLD_PX,
} from '../../shared/constants';

// ─── Props ───────────────────────────────────────────────────────────────────

export interface PopoverProps {
  /** Current popover state */
  state: PopoverState;
  /** Hover data to display when state is 'visible' or 'pinned' */
  data: HoverDisplayData | null;
  /** Error to display when state is 'error' */
  error: ExtensionError | null;
  /** Computed position for the popover */
  position: PopoverPosition | null;
  /** Called when the popover should be dismissed */
  onDismiss: () => void;
  /** Called when the user wants to pin/unpin the popover */
  onPin: () => void;
  /** Called when the user wants to retry after an error */
  onRetry?: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export const Popover: FunctionComponent<PopoverProps> = ({
  state,
  data,
  position,
  error,
  onDismiss,
  onPin,
  onRetry,
}) => {
  const popoverRef = useRef<HTMLDivElement>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollYRef = useRef<number>(0);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  // Detect prefers-reduced-motion
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mql.matches);
    const handler = (e: MediaQueryListEvent): void => {
      setPrefersReducedMotion(e.matches);
    };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  // Record scroll position when popover becomes visible
  useEffect(() => {
    if (state === 'visible' || state === 'loading') {
      scrollYRef.current = window.scrollY;
    }
  }, [state]);

  const clearDismissTimer = useCallback(() => {
    if (dismissTimerRef.current !== null) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  }, []);

  const startFadeOut = useCallback(() => {
    if (state === 'pinned') return;
    clearDismissTimer();

    if (prefersReducedMotion) {
      onDismiss();
      return;
    }

    setIsFadingOut(true);
    dismissTimerRef.current = setTimeout(() => {
      setIsFadingOut(false);
      onDismiss();
    }, POPOVER_FADE_DURATION_MS);
  }, [state, clearDismissTimer, onDismiss, prefersReducedMotion]);

  // Escape key listener
  useEffect(() => {
    if (state === 'hidden') return;

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        clearDismissTimer();
        setIsFadingOut(false);
        onDismiss();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [state, onDismiss, clearDismissTimer]);

  // Scroll listener — dismiss if scrolled >50px
  useEffect(() => {
    if (state === 'hidden' || state === 'pinned') return;

    const handleScroll = (): void => {
      const delta = Math.abs(window.scrollY - scrollYRef.current);
      if (delta > SCROLL_DISMISS_THRESHOLD_PX) {
        clearDismissTimer();
        setIsFadingOut(false);
        onDismiss();
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [state, onDismiss, clearDismissTimer]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => clearDismissTimer();
  }, [clearDismissTimer]);

  // Reset fade state when state changes
  useEffect(() => {
    if (state === 'hidden') {
      setIsFadingOut(false);
      clearDismissTimer();
    }
  }, [state, clearDismissTimer]);

  const handleMouseEnter = useCallback(() => {
    clearDismissTimer();
    setIsFadingOut(false);
  }, [clearDismissTimer]);

  const handleMouseLeave = useCallback(() => {
    if (state !== 'pinned') {
      startFadeOut();
    }
  }, [state, startFadeOut]);

  // ─── Hidden state: render nothing ────────────────────────────────────────

  if (state === 'hidden' || !position) {
    return null;
  }

  // ─── Compute styles ──────────────────────────────────────────────────────

  const fadeOpacity = isFadingOut ? 0 : 1;
  const transitionDuration = prefersReducedMotion
    ? '0.01ms'
    : `${POPOVER_FADE_DURATION_MS}ms`;

  const containerStyle: Record<string, string | number> = {
    position: 'fixed',
    top: `${position.top}px`,
    left: `${position.left}px`,
    zIndex: 2147483647,
    opacity: fadeOpacity,
    transition: `opacity ${transitionDuration} ease-in-out`,
    pointerEvents: 'auto',
  };

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div
      ref={popoverRef}
      class="gh-lsp-popover"
      style={containerStyle}
      role="tooltip"
      aria-live="polite"
      data-placement={position.placement}
      data-state={state}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div
        class="gh-lsp-popover__content"
        style={{
          maxHeight: `${MAX_POPOVER_HEIGHT_PX}px`,
          overflow: 'auto',
        }}
      >
        {state === 'loading' && <LoadingContent />}
        {(state === 'visible' || state === 'pinned') && data && (
          <HoverContent data={data} />
        )}
        {state === 'error' && error && (
          <ErrorContent error={error} onRetry={onRetry} onDismiss={onDismiss} />
        )}
      </div>

      {state === 'pinned' && (
        <button
          class="gh-lsp-popover__close-btn"
          onClick={onDismiss}
          aria-label="Close popover"
          type="button"
        >
          ×
        </button>
      )}

      {(state === 'visible') && (
        <button
          class="gh-lsp-popover__pin-btn"
          onClick={onPin}
          aria-label="Pin popover"
          type="button"
          title="Pin popover"
        >
          📌
        </button>
      )}
    </div>
  );
};

// ─── Sub-components ──────────────────────────────────────────────────────────

const LoadingContent: FunctionComponent = () => (
  <div class="gh-lsp-popover__loading" aria-label="Loading type information">
    <div class="gh-lsp-popover__skeleton gh-lsp-popover__skeleton--line" />
    <div class="gh-lsp-popover__skeleton gh-lsp-popover__skeleton--line gh-lsp-popover__skeleton--short" />
  </div>
);

interface HoverContentProps {
  data: HoverDisplayData;
}

const HoverContent: FunctionComponent<HoverContentProps> = ({ data }) => (
  <div class="gh-lsp-popover__hover-content">
    <pre class="gh-lsp-popover__signature">
      <code class={`language-${data.language}`}>{data.signature}</code>
    </pre>

    {data.documentation && (
      <div class="gh-lsp-popover__documentation">{data.documentation}</div>
    )}

    {data.parameters && data.parameters.length > 0 && (
      <div class="gh-lsp-popover__parameters">
        {data.parameters.map((param) => (
          <div class="gh-lsp-popover__param" key={param.name}>
            <span class="gh-lsp-popover__param-name">{param.name}</span>
            <span class="gh-lsp-popover__param-type">: {param.type}</span>
            {param.defaultValue && (
              <span class="gh-lsp-popover__param-default">
                {' '}= {param.defaultValue}
              </span>
            )}
            {param.documentation && (
              <span class="gh-lsp-popover__param-doc">
                {' '}&mdash; {param.documentation}
              </span>
            )}
          </div>
        ))}
      </div>
    )}

    {data.definitionLocation && (
      <div class="gh-lsp-popover__definition">
        <a
          class="gh-lsp-popover__definition-link"
          href={data.definitionLocation.uri}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Go to definition"
        >
          Go to Definition
        </a>
        {data.declarationSource && (
          <span class="gh-lsp-popover__declaration-source">
            {' '}in {data.declarationSource}
          </span>
        )}
      </div>
    )}
  </div>
);

interface ErrorContentProps {
  error: ExtensionError;
  onRetry?: () => void;
  onDismiss: () => void;
}

const ErrorContent: FunctionComponent<ErrorContentProps> = ({
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
