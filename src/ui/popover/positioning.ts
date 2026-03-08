import type { PopoverPosition } from '../../shared/types';

/** Gap in pixels between the token and the popover */
const POPOVER_GAP_PX = 4;

/** Input parameters for popover position calculation */
export interface PositionInput {
  /** getBoundingClientRect() of the hovered token element */
  tokenRect: DOMRect;
  /** Width of the popover element */
  popoverWidth: number;
  /** Height of the popover element */
  popoverHeight: number;
  /** Width of the viewport (window.innerWidth) */
  viewportWidth: number;
  /** Height of the viewport (window.innerHeight) */
  viewportHeight: number;
  /** Current vertical scroll offset (window.scrollY) */
  scrollY: number;
  /** Height of GitHub's sticky header (~60px) */
  stickyHeaderHeight: number;
}

/**
 * Calculates the pixel position for the popover relative to a hovered token.
 *
 * Algorithm:
 * 1. Default: place below the token, left-aligned with token start, 4px gap.
 * 2. If not enough space below, flip to above the token.
 * 3. If not enough space above either (sticky header), keep below and clamp.
 * 4. Horizontal: shift left if overflow right, clamp to 0 if overflow left.
 *
 * @param input - The positioning parameters
 * @returns The computed position with top, left, and placement direction
 */
export function calculatePopoverPosition(input: PositionInput): PopoverPosition {
  const {
    tokenRect,
    popoverWidth,
    popoverHeight,
    viewportWidth,
    viewportHeight,
    stickyHeaderHeight,
  } = input;

  // --- Vertical positioning ---
  let top: number;
  let placement: 'above' | 'below';

  const spaceBelow = viewportHeight - tokenRect.bottom - POPOVER_GAP_PX;
  const spaceAbove = tokenRect.top - stickyHeaderHeight - POPOVER_GAP_PX;

  if (spaceBelow >= popoverHeight) {
    // Default: place below the token
    top = tokenRect.bottom + POPOVER_GAP_PX;
    placement = 'below';
  } else if (spaceAbove >= popoverHeight) {
    // Flip to above the token
    top = tokenRect.top - popoverHeight - POPOVER_GAP_PX;
    placement = 'above';
  } else {
    // Neither side has enough space — keep below and clamp
    top = tokenRect.bottom + POPOVER_GAP_PX;
    placement = 'below';
  }

  // --- Horizontal positioning ---
  let left = tokenRect.left;

  // Shift left if the popover would overflow the right edge
  if (left + popoverWidth > viewportWidth) {
    left = viewportWidth - popoverWidth;
  }

  // Clamp to 0 if shifted past the left edge
  if (left < 0) {
    left = 0;
  }

  return { top, left, placement };
}
