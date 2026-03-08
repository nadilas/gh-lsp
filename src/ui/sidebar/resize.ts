import type { SidebarPosition } from '../../shared/types';
import { SIDEBAR_MIN_SIZE_PX } from '../../shared/constants';
import { saveSettings } from '../../shared/settings';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ResizeOptions {
  /** Sidebar dock position — determines drag axis and delta direction */
  position: SidebarPosition;
  /** Current size in pixels before the drag starts */
  currentSize: number;
  /** Called on every mousemove with the clamped new size */
  onResize: (size: number) => void;
  /** Called when the drag finishes (mouseup), with final size */
  onResizeEnd?: (size: number) => void;
  /** Whether to persist the final size to extension settings (default: true) */
  persistSize?: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Returns `true` for left/right (horizontal) positions where the sidebar
 * spans the full height and its width is resized.
 */
export function isHorizontalPosition(position: SidebarPosition): boolean {
  return position === 'left' || position === 'right';
}

/**
 * Computes the maximum allowed size for the sidebar, which is 50 % of the
 * relevant viewport dimension (width for left/right, height for top/bottom).
 */
export function getMaxSize(position: SidebarPosition): number {
  if (isHorizontalPosition(position)) {
    return window.innerWidth * 0.5;
  }
  return window.innerHeight * 0.5;
}

/**
 * Clamps `value` between `SIDEBAR_MIN_SIZE_PX` and `maxSize`.
 */
export function clampSize(value: number, maxSize: number): number {
  return Math.max(SIDEBAR_MIN_SIZE_PX, Math.min(maxSize, value));
}

/**
 * Computes the delta between the starting mouse coordinate and the current
 * one, taking the sidebar position into account:
 *
 *  - **right / bottom** — dragging *toward* the viewport origin *increases*
 *    size, so `delta = start − current`.
 *  - **left / top** — dragging *away* from the viewport origin *increases*
 *    size, so `delta = current − start`.
 */
export function computeDelta(
  position: SidebarPosition,
  startCoord: number,
  currentCoord: number,
): number {
  if (position === 'right' || position === 'bottom') {
    return startCoord - currentCoord;
  }
  return currentCoord - startCoord;
}

// ─── Main handler ───────────────────────────────────────────────────────────

/**
 * Creates a `mousedown` handler that, when invoked, tracks `mousemove` and
 * `mouseup` to let the user resize the sidebar by dragging its edge handle.
 *
 * Usage in a Preact component:
 * ```tsx
 * <div onMouseDown={createResizeHandler({ position, currentSize, onResize })} />
 * ```
 */
export function createResizeHandler(
  options: ResizeOptions,
): (e: MouseEvent) => void {
  return (e: MouseEvent): void => {
    e.preventDefault();

    const { position, currentSize, onResize, onResizeEnd, persistSize = true } =
      options;

    const horizontal = isHorizontalPosition(position);
    const startCoord = horizontal ? e.clientX : e.clientY;
    const startSize = currentSize;

    let lastSize = startSize;

    const handleMouseMove = (moveEvent: MouseEvent): void => {
      const currentCoord = horizontal
        ? moveEvent.clientX
        : moveEvent.clientY;

      const delta = computeDelta(position, startCoord, currentCoord);
      const maxSize = getMaxSize(position);
      const newSize = clampSize(startSize + delta, maxSize);

      lastSize = newSize;
      onResize(newSize);
    };

    const handleMouseUp = (): void => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');

      onResizeEnd?.(lastSize);

      if (persistSize) {
        void saveSettings({ sidebarSize: lastSize });
      }
    };

    // Visual feedback during drag
    document.body.style.cursor = horizontal ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };
}
