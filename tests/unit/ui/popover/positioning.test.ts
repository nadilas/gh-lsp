import { describe, it, expect } from 'vitest';
import {
  calculatePopoverPosition,
  type PositionInput,
} from '../../../../src/ui/popover/positioning';

/**
 * Helper to create a mock DOMRect with the specified properties.
 * DOMRect's computed properties (right, bottom) are derived from x/y/width/height.
 */
function createRect(
  x: number,
  y: number,
  width: number,
  height: number,
): DOMRect {
  return new DOMRect(x, y, width, height);
}

/** Default input that places a token in the upper-left of a large viewport */
function createDefaultInput(overrides: Partial<PositionInput> = {}): PositionInput {
  return {
    tokenRect: createRect(100, 100, 60, 20),
    popoverWidth: 300,
    popoverHeight: 200,
    viewportWidth: 1280,
    viewportHeight: 800,
    scrollY: 0,
    stickyHeaderHeight: 60,
    ...overrides,
  };
}

const GAP = 4;

describe('calculatePopoverPosition', () => {
  describe('default placement (below token)', () => {
    it('places popover below the token with 4px gap', () => {
      const input = createDefaultInput();
      const result = calculatePopoverPosition(input);

      expect(result.placement).toBe('below');
      expect(result.top).toBe(input.tokenRect.bottom + GAP); // 120 + 4 = 124
      expect(result.left).toBe(input.tokenRect.left); // 100
    });

    it('left-aligns popover with token start', () => {
      const input = createDefaultInput({
        tokenRect: createRect(250, 100, 80, 20),
      });
      const result = calculatePopoverPosition(input);

      expect(result.left).toBe(250);
      expect(result.placement).toBe('below');
    });
  });

  describe('flips above when no space below', () => {
    it('places popover above when token is near viewport bottom', () => {
      // Token near bottom: bottom = 700, popoverHeight = 200
      // spaceBelow = 800 - 700 - 4 = 96 (< 200) → flip above
      // spaceAbove = 680 - 60 - 4 = 616 (>= 200) → fits above
      const input = createDefaultInput({
        tokenRect: createRect(100, 680, 60, 20),
      });
      const result = calculatePopoverPosition(input);

      expect(result.placement).toBe('above');
      expect(result.top).toBe(680 - 200 - GAP); // 476
    });

    it('places popover above when only barely not fitting below', () => {
      // Token bottom = 601, viewportHeight = 800
      // spaceBelow = 800 - 601 - 4 = 195 (< 200) → flip
      // spaceAbove = 581 - 60 - 4 = 517 (>= 200) → fits
      const input = createDefaultInput({
        tokenRect: createRect(100, 581, 60, 20),
      });
      const result = calculatePopoverPosition(input);

      expect(result.placement).toBe('above');
      expect(result.top).toBe(581 - 200 - GAP); // 377
    });
  });

  describe('stays below when no space above either (clamp)', () => {
    it('keeps below placement when neither side has enough space', () => {
      // Token at y=100, height=20 → top=100, bottom=120
      // viewportHeight = 300, popoverHeight = 200
      // spaceBelow = 300 - 120 - 4 = 176 (< 200) → try above
      // spaceAbove = 100 - 60 - 4 = 36 (< 200) → keep below, clamp
      const input = createDefaultInput({
        tokenRect: createRect(100, 100, 60, 20),
        viewportHeight: 300,
      });
      const result = calculatePopoverPosition(input);

      expect(result.placement).toBe('below');
      expect(result.top).toBe(120 + GAP); // 124
    });

    it('keeps below when token is near sticky header', () => {
      // Token y=65 (just below 60px header), height=20 → top=65, bottom=85
      // spaceBelow = 300 - 85 - 4 = 211 (>= 200) → fits below actually
      // Let's make viewportHeight small enough that it doesn't fit below either
      const input = createDefaultInput({
        tokenRect: createRect(100, 65, 60, 20),
        viewportHeight: 280,
        stickyHeaderHeight: 60,
      });
      // spaceBelow = 280 - 85 - 4 = 191 (< 200) → try above
      // spaceAbove = 65 - 60 - 4 = 1 (< 200) → clamp below
      const result = calculatePopoverPosition(input);

      expect(result.placement).toBe('below');
      expect(result.top).toBe(85 + GAP); // 89
    });
  });

  describe('horizontal positioning', () => {
    it('shifts left when popover would overflow right edge', () => {
      // Token at x=1100, popoverWidth=300, viewportWidth=1280
      // 1100 + 300 = 1400 > 1280 → shift to 1280 - 300 = 980
      const input = createDefaultInput({
        tokenRect: createRect(1100, 100, 60, 20),
      });
      const result = calculatePopoverPosition(input);

      expect(result.left).toBe(980);
    });

    it('clamps to 0 when popover would overflow left edge', () => {
      // Token at x=5, popoverWidth=300, viewportWidth=200
      // 5 + 300 = 305 > 200 → shift to 200 - 300 = -100 → clamp to 0
      const input = createDefaultInput({
        tokenRect: createRect(5, 100, 30, 20),
        popoverWidth: 300,
        viewportWidth: 200,
      });
      const result = calculatePopoverPosition(input);

      expect(result.left).toBe(0);
    });

    it('does not shift when popover fits within viewport', () => {
      const input = createDefaultInput({
        tokenRect: createRect(100, 100, 60, 20),
        popoverWidth: 300,
        viewportWidth: 1280,
      });
      const result = calculatePopoverPosition(input);

      expect(result.left).toBe(100);
    });

    it('handles token at far left edge (x=0)', () => {
      const input = createDefaultInput({
        tokenRect: createRect(0, 100, 40, 20),
      });
      const result = calculatePopoverPosition(input);

      expect(result.left).toBe(0);
    });
  });

  describe('accounts for sticky header', () => {
    it('uses stickyHeaderHeight when computing space above', () => {
      // Token y=200, height=20 → top=200, bottom=220
      // stickyHeaderHeight = 100
      // viewportHeight = 300
      // spaceBelow = 300 - 220 - 4 = 76 (< 200) → try above
      // spaceAbove = 200 - 100 - 4 = 96 (< 200) → not enough above, clamp below
      const input = createDefaultInput({
        tokenRect: createRect(100, 200, 60, 20),
        stickyHeaderHeight: 100,
        viewportHeight: 300,
      });
      const result = calculatePopoverPosition(input);

      expect(result.placement).toBe('below');
    });

    it('flips above when enough space above header', () => {
      // Token y=400, height=20 → top=400, bottom=420
      // stickyHeaderHeight = 60
      // viewportHeight = 500
      // spaceBelow = 500 - 420 - 4 = 76 (< 200) → try above
      // spaceAbove = 400 - 60 - 4 = 336 (>= 200) → fits above
      const input = createDefaultInput({
        tokenRect: createRect(100, 400, 60, 20),
        stickyHeaderHeight: 60,
        viewportHeight: 500,
      });
      const result = calculatePopoverPosition(input);

      expect(result.placement).toBe('above');
      expect(result.top).toBe(400 - 200 - GAP); // 196
    });

    it('handles zero sticky header height', () => {
      const input = createDefaultInput({
        tokenRect: createRect(100, 50, 60, 20),
        stickyHeaderHeight: 0,
        viewportHeight: 100,
      });
      // spaceBelow = 100 - 70 - 4 = 26 (< 200) → try above
      // spaceAbove = 50 - 0 - 4 = 46 (< 200) → clamp below
      const result = calculatePopoverPosition(input);

      expect(result.placement).toBe('below');
      expect(result.top).toBe(70 + GAP);
    });
  });

  describe('token at viewport edges', () => {
    it('handles token at top-left corner', () => {
      const input = createDefaultInput({
        tokenRect: createRect(0, 0, 40, 16),
        stickyHeaderHeight: 0,
      });
      // spaceBelow = 800 - 16 - 4 = 780 (>= 200) → below
      const result = calculatePopoverPosition(input);

      expect(result.placement).toBe('below');
      expect(result.top).toBe(16 + GAP); // 20
      expect(result.left).toBe(0);
    });

    it('handles token at bottom-right corner', () => {
      const input = createDefaultInput({
        tokenRect: createRect(1200, 780, 80, 20),
      });
      // spaceBelow = 800 - 800 - 4 = -4 (< 200) → try above
      // spaceAbove = 780 - 60 - 4 = 716 (>= 200) → above
      // left = 1200, 1200 + 300 = 1500 > 1280 → shift to 980
      const result = calculatePopoverPosition(input);

      expect(result.placement).toBe('above');
      expect(result.top).toBe(780 - 200 - GAP); // 576
      expect(result.left).toBe(1280 - 300); // 980
    });

    it('handles token wider than popover', () => {
      const input = createDefaultInput({
        tokenRect: createRect(100, 100, 400, 20),
        popoverWidth: 300,
      });
      const result = calculatePopoverPosition(input);

      // Left should still be aligned with token start
      expect(result.left).toBe(100);
    });
  });

  describe('exact boundary conditions', () => {
    it('places below when space exactly equals popover height', () => {
      // spaceBelow = viewportHeight - tokenRect.bottom - 4 = popoverHeight exactly
      // tokenRect.bottom = viewportHeight - popoverHeight - 4
      // bottom = 800 - 200 - 4 = 596
      const input = createDefaultInput({
        tokenRect: createRect(100, 576, 60, 20), // bottom = 596
        popoverHeight: 200,
        viewportHeight: 800,
      });
      // spaceBelow = 800 - 596 - 4 = 200, exactly == 200 → fits below
      const result = calculatePopoverPosition(input);

      expect(result.placement).toBe('below');
      expect(result.top).toBe(596 + GAP);
    });

    it('flips above when space below is one pixel short', () => {
      const input = createDefaultInput({
        tokenRect: createRect(100, 577, 60, 20), // bottom = 597
        popoverHeight: 200,
        viewportHeight: 800,
      });
      // spaceBelow = 800 - 597 - 4 = 199 (< 200) → flip above
      // spaceAbove = 577 - 60 - 4 = 513 (>= 200) → fits
      const result = calculatePopoverPosition(input);

      expect(result.placement).toBe('above');
    });

    it('places at exact right edge without shifting', () => {
      // left + popoverWidth = viewportWidth exactly
      const input = createDefaultInput({
        tokenRect: createRect(980, 100, 60, 20),
        popoverWidth: 300,
        viewportWidth: 1280,
      });
      // 980 + 300 = 1280, not > 1280 → no shift
      const result = calculatePopoverPosition(input);

      expect(result.left).toBe(980);
    });

    it('shifts left when one pixel past right edge', () => {
      const input = createDefaultInput({
        tokenRect: createRect(981, 100, 60, 20),
        popoverWidth: 300,
        viewportWidth: 1280,
      });
      // 981 + 300 = 1281 > 1280 → shift to 1280 - 300 = 980
      const result = calculatePopoverPosition(input);

      expect(result.left).toBe(980);
    });
  });

  describe('small viewport scenarios', () => {
    it('handles very small viewport where popover is larger than viewport', () => {
      const input = createDefaultInput({
        tokenRect: createRect(10, 50, 30, 16),
        popoverWidth: 400,
        popoverHeight: 300,
        viewportWidth: 320,
        viewportHeight: 200,
        stickyHeaderHeight: 0,
      });
      // spaceBelow = 200 - 66 - 4 = 130 (< 300) → try above
      // spaceAbove = 50 - 0 - 4 = 46 (< 300) → clamp below
      // left = 10, 10 + 400 > 320 → shift to 320 - 400 = -80 → clamp to 0
      const result = calculatePopoverPosition(input);

      expect(result.placement).toBe('below');
      expect(result.top).toBe(66 + GAP);
      expect(result.left).toBe(0);
    });
  });

  describe('return value structure', () => {
    it('returns an object with top, left, and placement', () => {
      const input = createDefaultInput();
      const result = calculatePopoverPosition(input);

      expect(result).toHaveProperty('top');
      expect(result).toHaveProperty('left');
      expect(result).toHaveProperty('placement');
      expect(typeof result.top).toBe('number');
      expect(typeof result.left).toBe('number');
      expect(['above', 'below']).toContain(result.placement);
    });
  });
});
