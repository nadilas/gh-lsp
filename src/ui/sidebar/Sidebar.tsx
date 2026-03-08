import { type FunctionComponent } from 'preact';
import { useEffect, useRef, useCallback, useState } from 'preact/hooks';
import type {
  SidebarState,
  SidebarPosition,
  HoverDisplayData,
  ExtensionError,
} from '../../shared/types';
import { SIDEBAR_MIN_SIZE_PX } from '../../shared/constants';
import { SignatureDisplay } from '../components/SignatureDisplay';
import { MarkdownRenderer } from '../components/MarkdownRenderer';
import { ParameterList } from '../components/ParameterList';
import { DefinitionLink } from '../components/DefinitionLink';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { createResizeHandler, isHorizontalPosition } from './resize';

// ─── Props ───────────────────────────────────────────────────────────────────

export interface SidebarProps {
  /** Dock position of the sidebar */
  position: SidebarPosition;
  /** Current sidebar state */
  state: SidebarState;
  /** Hover data to display when available */
  data: HoverDisplayData | null;
  /** Error to display */
  error: ExtensionError | null;
  /** Whether content is currently loading */
  loading: boolean;
  /** Called to toggle collapse/expand */
  onToggle: () => void;
  /** Called when retry is requested after error */
  onRetry?: () => void;
  /** Called when sidebar is dismissed */
  onDismiss?: () => void;
  /** Custom size in pixels (overrides default) */
  size?: number;
  /** Called when size changes via resize */
  onSizeChange?: (size: number) => void;
}

// ─── Position Helpers ────────────────────────────────────────────────────────

function getPositionStyles(
  position: SidebarPosition,
  state: SidebarState,
  size: number,
): Record<string, string> {
  const collapsedSize = '36px';
  const effectiveSize = state === 'collapsed' ? collapsedSize : `${size}px`;

  const base: Record<string, string> = {
    position: 'fixed',
    zIndex: '2147483646',
    display: state === 'hidden' ? 'none' : 'flex',
    flexDirection: 'column',
    boxSizing: 'border-box',
  };

  if (isHorizontalPosition(position)) {
    base.top = '0';
    base.height = '100vh';
    base.width = effectiveSize;
    if (position === 'right') {
      base.right = '0';
    } else {
      base.left = '0';
    }
  } else {
    base.left = '0';
    base.width = '100vw';
    base.height = effectiveSize;
    if (position === 'bottom') {
      base.bottom = '0';
    } else {
      base.top = '0';
    }
  }

  return base;
}

// ─── Component ───────────────────────────────────────────────────────────────

export const Sidebar: FunctionComponent<SidebarProps> = ({
  position,
  state,
  data,
  error,
  loading,
  onToggle,
  onRetry,
  onDismiss,
  size: sizeProp,
  onSizeChange,
}) => {
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [internalSize, setInternalSize] = useState(
    sizeProp ?? SIDEBAR_MIN_SIZE_PX + 100,
  );

  const effectiveSize = sizeProp ?? internalSize;

  // Sync prop size to internal state
  useEffect(() => {
    if (sizeProp !== undefined) {
      setInternalSize(sizeProp);
    }
  }, [sizeProp]);

  // Keyboard shortcut to toggle
  useEffect(() => {
    if (state === 'hidden') return;

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && state === 'expanded') {
        e.preventDefault();
        onToggle();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [state, onToggle]);

  // Resize handling via drag — delegated to the extracted resize module
  const handleResizeStart = useCallback(
    (e: MouseEvent) => {
      const handler = createResizeHandler({
        position,
        currentSize: effectiveSize,
        onResize: (size) => {
          setInternalSize(size);
          onSizeChange?.(size);
        },
      });
      handler(e);
    },
    [position, effectiveSize, onSizeChange],
  );

  // ─── Hidden state: render nothing ────────────────────────────────────────

  if (state === 'hidden') {
    return null;
  }

  // ─── Compute styles ──────────────────────────────────────────────────────

  const containerStyle = getPositionStyles(position, state, effectiveSize);

  // ─── Collapse/expand arrow direction ─────────────────────────────────────

  const getToggleArrow = (): string => {
    if (state === 'collapsed') {
      switch (position) {
        case 'right':
          return '\u25C0'; // left arrow
        case 'left':
          return '\u25B6'; // right arrow
        case 'top':
          return '\u25BC'; // down arrow
        case 'bottom':
          return '\u25B2'; // up arrow
      }
    } else {
      switch (position) {
        case 'right':
          return '\u25B6'; // right arrow
        case 'left':
          return '\u25C0'; // left arrow
        case 'top':
          return '\u25B2'; // up arrow
        case 'bottom':
          return '\u25BC'; // down arrow
      }
    }
  };

  // ─── Resize handle position ──────────────────────────────────────────────

  const getResizeHandleStyle = (): Record<string, string> => {
    const base: Record<string, string> = {
      position: 'absolute',
      zIndex: '1',
    };

    if (isHorizontalPosition(position)) {
      base.top = '0';
      base.height = '100%';
      base.width = '4px';
      base.cursor = 'col-resize';
      if (position === 'right') {
        base.left = '0';
      } else {
        base.right = '0';
      }
    } else {
      base.left = '0';
      base.width = '100%';
      base.height = '4px';
      base.cursor = 'row-resize';
      if (position === 'bottom') {
        base.top = '0';
      } else {
        base.bottom = '0';
      }
    }

    return base;
  };

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div
      ref={sidebarRef}
      class={`gh-lsp-sidebar gh-lsp-sidebar--${position}`}
      style={containerStyle}
      role="complementary"
      aria-label="Code intelligence"
      data-state={state}
      data-position={position}
    >
      {/* Resize handle (only when expanded) */}
      {state === 'expanded' && (
        <div
          class="gh-lsp-sidebar__resize-handle"
          style={getResizeHandleStyle()}
          onMouseDown={handleResizeStart}
          aria-hidden="true"
        />
      )}

      {/* Header */}
      <div class="gh-lsp-sidebar__header">
        <button
          class="gh-lsp-sidebar__toggle-btn"
          onClick={onToggle}
          type="button"
          aria-label={state === 'collapsed' ? 'Expand sidebar' : 'Collapse sidebar'}
          title={state === 'collapsed' ? 'Expand' : 'Collapse'}
        >
          {getToggleArrow()}
        </button>
        {state === 'expanded' && (
          <span class="gh-lsp-sidebar__title">
            {data ? data.signature.split('(')[0].trim() : 'Code Intelligence'}
          </span>
        )}
      </div>

      {/* Content area (only when expanded) */}
      {state === 'expanded' && (
        <div class="gh-lsp-sidebar__content">
          {loading && <LoadingState />}

          {!loading && !data && !error && (
            <div class="gh-lsp-sidebar__empty">
              Hover over a symbol to see type info
            </div>
          )}

          {!loading && data && (
            <div class="gh-lsp-sidebar__data">
              <SignatureDisplay
                signature={data.signature}
                language={data.language}
              />

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
          )}

          {!loading && error && (
            <ErrorState
              error={error}
              onRetry={onRetry}
              onDismiss={onDismiss ?? onToggle}
            />
          )}
        </div>
      )}
    </div>
  );
};
