import { type FunctionComponent } from 'preact';
import { useEffect, useRef, useCallback, useState } from 'preact/hooks';
import { t } from '../../shared/i18n';
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
import { SignatureDisplay } from '../components/SignatureDisplay';
import { MarkdownRenderer } from '../components/MarkdownRenderer';
import { ParameterList } from '../components/ParameterList';
import { DefinitionLink } from '../components/DefinitionLink';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';

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

  // Escape key listener + focus trap for pinned popover
  useEffect(() => {
    if (state === 'hidden') return;

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        clearDismissTimer();
        setIsFadingOut(false);
        onDismiss();
        return;
      }

      // Focus trap: only active when pinned — Tab cycles through interactive elements
      if (e.key === 'Tab' && state === 'pinned' && popoverRef.current) {
        const popover = popoverRef.current;
        const focusableSelector =
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';
        const focusable = Array.from(
          popover.querySelectorAll<HTMLElement>(focusableSelector),
        );

        if (focusable.length === 0) return;

        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;

        if (e.shiftKey) {
          if (document.activeElement === first || !popover.contains(document.activeElement)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last || !popover.contains(document.activeElement)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    // Move focus into the popover when pinned
    if (state === 'pinned' && popoverRef.current) {
      const focusable = popoverRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length > 0) {
        focusable[0]!.focus();
      }
    }

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
        aria-busy={state === 'loading'}
      >
        {state === 'loading' && <LoadingState />}
        {(state === 'visible' || state === 'pinned') && data && (
          <HoverContent data={data} />
        )}
        {state === 'error' && error && (
          <ErrorState error={error} onRetry={onRetry} onDismiss={onDismiss} />
        )}
      </div>

      {state === 'pinned' && (
        <button
          class="gh-lsp-popover__close-btn"
          onClick={onDismiss}
          aria-label={t('ariaLabelClosePopover', 'Close popover')}
          type="button"
        >
          ×
        </button>
      )}

      {(state === 'visible') && (
        <button
          class="gh-lsp-popover__pin-btn"
          onClick={onPin}
          aria-label={t('ariaLabelPinPopover', 'Pin popover')}
          type="button"
          title="Pin popover"
        >
          📌
        </button>
      )}
    </div>
  );
};

// ─── HoverContent (uses extracted subcomponents) ─────────────────────────────

interface HoverContentProps {
  data: HoverDisplayData;
}

const HoverContent: FunctionComponent<HoverContentProps> = ({ data }) => (
  <div class="gh-lsp-popover__hover-content">
    <SignatureDisplay signature={data.signature} language={data.language} />

    {data.documentation && (
      <MarkdownRenderer content={data.documentation} />
    )}

    {data.parameters && data.parameters.length > 0 && (
      <ParameterList parameters={data.parameters} />
    )}

    {data.definitionLocation && (
      <DefinitionLink
        location={data.definitionLocation}
        declarationSource={data.declarationSource}
      />
    )}
  </div>
);
