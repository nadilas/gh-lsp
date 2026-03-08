import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isHorizontalPosition,
  getMaxSize,
  clampSize,
  computeDelta,
  createResizeHandler,
  type ResizeOptions,
} from '../../../../src/ui/sidebar/resize';
import { SIDEBAR_MIN_SIZE_PX } from '../../../../src/shared/constants';

// Mock saveSettings to prevent chrome.storage calls
vi.mock('../../../../src/shared/settings', () => ({
  saveSettings: vi.fn().mockResolvedValue(undefined),
}));

describe('resize', () => {
  // ─── isHorizontalPosition ─────────────────────────────────────────────────

  describe('isHorizontalPosition', () => {
    it('returns true for "left"', () => {
      expect(isHorizontalPosition('left')).toBe(true);
    });

    it('returns true for "right"', () => {
      expect(isHorizontalPosition('right')).toBe(true);
    });

    it('returns false for "top"', () => {
      expect(isHorizontalPosition('top')).toBe(false);
    });

    it('returns false for "bottom"', () => {
      expect(isHorizontalPosition('bottom')).toBe(false);
    });
  });

  // ─── getMaxSize ───────────────────────────────────────────────────────────

  describe('getMaxSize', () => {
    beforeEach(() => {
      Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
      Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    });

    it('returns 50% of viewport width for "left"', () => {
      expect(getMaxSize('left')).toBe(600);
    });

    it('returns 50% of viewport width for "right"', () => {
      expect(getMaxSize('right')).toBe(600);
    });

    it('returns 50% of viewport height for "top"', () => {
      expect(getMaxSize('top')).toBe(400);
    });

    it('returns 50% of viewport height for "bottom"', () => {
      expect(getMaxSize('bottom')).toBe(400);
    });
  });

  // ─── clampSize ────────────────────────────────────────────────────────────

  describe('clampSize', () => {
    it('returns the value when within bounds', () => {
      expect(clampSize(300, 600)).toBe(300);
    });

    it('clamps to SIDEBAR_MIN_SIZE_PX when value is too small', () => {
      expect(clampSize(50, 600)).toBe(SIDEBAR_MIN_SIZE_PX);
    });

    it('clamps to maxSize when value exceeds it', () => {
      expect(clampSize(800, 600)).toBe(600);
    });

    it('returns SIDEBAR_MIN_SIZE_PX for negative values', () => {
      expect(clampSize(-100, 600)).toBe(SIDEBAR_MIN_SIZE_PX);
    });

    it('returns SIDEBAR_MIN_SIZE_PX exactly when value equals it', () => {
      expect(clampSize(SIDEBAR_MIN_SIZE_PX, 600)).toBe(SIDEBAR_MIN_SIZE_PX);
    });

    it('returns maxSize exactly when value equals it', () => {
      expect(clampSize(600, 600)).toBe(600);
    });
  });

  // ─── computeDelta ─────────────────────────────────────────────────────────

  describe('computeDelta', () => {
    it('right position: dragging left (toward origin) increases size', () => {
      // startCoord=500, currentCoord=400 → delta = 500 - 400 = 100
      expect(computeDelta('right', 500, 400)).toBe(100);
    });

    it('right position: dragging right (away from origin) decreases size', () => {
      // startCoord=500, currentCoord=600 → delta = 500 - 600 = -100
      expect(computeDelta('right', 500, 600)).toBe(-100);
    });

    it('left position: dragging right (away from origin) increases size', () => {
      // startCoord=200, currentCoord=300 → delta = 300 - 200 = 100
      expect(computeDelta('left', 200, 300)).toBe(100);
    });

    it('left position: dragging left (toward origin) decreases size', () => {
      // startCoord=200, currentCoord=100 → delta = 100 - 200 = -100
      expect(computeDelta('left', 200, 100)).toBe(-100);
    });

    it('bottom position: dragging up (toward origin) increases size', () => {
      // startCoord=600, currentCoord=500 → delta = 600 - 500 = 100
      expect(computeDelta('bottom', 600, 500)).toBe(100);
    });

    it('bottom position: dragging down (away from origin) decreases size', () => {
      // startCoord=600, currentCoord=700 → delta = 600 - 700 = -100
      expect(computeDelta('bottom', 600, 700)).toBe(-100);
    });

    it('top position: dragging down (away from origin) increases size', () => {
      // startCoord=100, currentCoord=200 → delta = 200 - 100 = 100
      expect(computeDelta('top', 100, 200)).toBe(100);
    });

    it('top position: dragging up (toward origin) decreases size', () => {
      // startCoord=100, currentCoord=50 → delta = 50 - 100 = -50
      expect(computeDelta('top', 100, 50)).toBe(-50);
    });

    it('returns 0 when no movement', () => {
      expect(computeDelta('right', 300, 300)).toBe(0);
      expect(computeDelta('left', 300, 300)).toBe(0);
      expect(computeDelta('top', 300, 300)).toBe(0);
      expect(computeDelta('bottom', 300, 300)).toBe(0);
    });
  });

  // ─── createResizeHandler ──────────────────────────────────────────────────

  describe('createResizeHandler', () => {
    let onResize: ReturnType<typeof vi.fn>;
    let onResizeEnd: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      onResize = vi.fn();
      onResizeEnd = vi.fn();
      Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
      Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    });

    afterEach(() => {
      // Trigger mouseup to clean up any dangling listeners
      document.dispatchEvent(new MouseEvent('mouseup'));
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
      vi.restoreAllMocks();
    });

    function createMouseEvent(
      type: string,
      clientX: number,
      clientY: number,
    ): MouseEvent {
      return new MouseEvent(type, { clientX, clientY, bubbles: true });
    }

    function startDrag(options: ResizeOptions, clientX: number, clientY: number): void {
      const handler = createResizeHandler(options);
      const mousedown = createMouseEvent('mousedown', clientX, clientY);
      // Stub preventDefault
      vi.spyOn(mousedown, 'preventDefault');
      handler(mousedown);
    }

    it('sets col-resize cursor for horizontal positions', () => {
      startDrag(
        { position: 'right', currentSize: 300, onResize, persistSize: false },
        500,
        300,
      );
      expect(document.body.style.cursor).toBe('col-resize');
    });

    it('sets row-resize cursor for vertical positions', () => {
      startDrag(
        { position: 'bottom', currentSize: 300, onResize, persistSize: false },
        500,
        600,
      );
      expect(document.body.style.cursor).toBe('row-resize');
    });

    it('sets user-select to none during drag', () => {
      startDrag(
        { position: 'right', currentSize: 300, onResize, persistSize: false },
        500,
        300,
      );
      expect(document.body.style.userSelect).toBe('none');
    });

    it('calls onResize on mousemove for right position', () => {
      startDrag(
        { position: 'right', currentSize: 300, onResize, persistSize: false },
        500,
        300,
      );

      // Drag left by 100px → size increases by 100
      document.dispatchEvent(createMouseEvent('mousemove', 400, 300));
      expect(onResize).toHaveBeenCalledWith(400); // 300 + 100
    });

    it('calls onResize on mousemove for left position', () => {
      startDrag(
        { position: 'left', currentSize: 300, onResize, persistSize: false },
        200,
        300,
      );

      // Drag right by 50px → size increases by 50
      document.dispatchEvent(createMouseEvent('mousemove', 250, 300));
      expect(onResize).toHaveBeenCalledWith(350); // 300 + 50
    });

    it('calls onResize on mousemove for bottom position', () => {
      startDrag(
        { position: 'bottom', currentSize: 250, onResize, persistSize: false },
        500,
        700,
      );

      // Drag up by 80px → size increases by 80
      document.dispatchEvent(createMouseEvent('mousemove', 500, 620));
      expect(onResize).toHaveBeenCalledWith(330); // 250 + 80
    });

    it('calls onResize on mousemove for top position', () => {
      startDrag(
        { position: 'top', currentSize: 250, onResize, persistSize: false },
        500,
        200,
      );

      // Drag down by 30px → size increases by 30
      document.dispatchEvent(createMouseEvent('mousemove', 500, 230));
      expect(onResize).toHaveBeenCalledWith(280); // 250 + 30
    });

    it('clamps size to minimum on mousemove', () => {
      startDrag(
        { position: 'right', currentSize: 250, onResize, persistSize: false },
        500,
        300,
      );

      // Drag right by 200px → would be 250 - 200 = 50, clamped to SIDEBAR_MIN_SIZE_PX
      document.dispatchEvent(createMouseEvent('mousemove', 700, 300));
      expect(onResize).toHaveBeenCalledWith(SIDEBAR_MIN_SIZE_PX);
    });

    it('clamps size to max (50% viewport) on mousemove', () => {
      startDrag(
        { position: 'right', currentSize: 300, onResize, persistSize: false },
        500,
        300,
      );

      // Drag left by 500px → would be 300 + 500 = 800, clamped to 600 (50% of 1200)
      document.dispatchEvent(createMouseEvent('mousemove', 0, 300));
      expect(onResize).toHaveBeenCalledWith(600);
    });

    it('clamps vertical size to max (50% viewport height)', () => {
      startDrag(
        { position: 'top', currentSize: 200, onResize, persistSize: false },
        500,
        100,
      );

      // Drag down by 500px → would be 200 + 500 = 700, clamped to 400 (50% of 800)
      document.dispatchEvent(createMouseEvent('mousemove', 500, 600));
      expect(onResize).toHaveBeenCalledWith(400);
    });

    it('removes event listeners and resets styles on mouseup', () => {
      startDrag(
        { position: 'right', currentSize: 300, onResize, persistSize: false },
        500,
        300,
      );

      document.dispatchEvent(createMouseEvent('mouseup', 400, 300));

      // After mouseup, cursor and user-select should be removed
      expect(document.body.style.cursor).toBe('');
      expect(document.body.style.userSelect).toBe('');

      // Further mousemove should NOT call onResize
      onResize.mockClear();
      document.dispatchEvent(createMouseEvent('mousemove', 350, 300));
      expect(onResize).not.toHaveBeenCalled();
    });

    it('calls onResizeEnd on mouseup with final size', () => {
      startDrag(
        { position: 'right', currentSize: 300, onResize, onResizeEnd, persistSize: false },
        500,
        300,
      );

      document.dispatchEvent(createMouseEvent('mousemove', 450, 300));
      document.dispatchEvent(createMouseEvent('mouseup', 450, 300));

      expect(onResizeEnd).toHaveBeenCalledWith(350); // 300 + (500 - 450) = 350
    });

    it('calls onResizeEnd with start size if no mousemove', () => {
      startDrag(
        { position: 'right', currentSize: 300, onResize, onResizeEnd, persistSize: false },
        500,
        300,
      );

      document.dispatchEvent(createMouseEvent('mouseup', 500, 300));
      expect(onResizeEnd).toHaveBeenCalledWith(300);
    });

    it('persists size via saveSettings by default', async () => {
      const { saveSettings } = await import('../../../../src/shared/settings');

      startDrag(
        { position: 'right', currentSize: 300, onResize },
        500,
        300,
      );

      document.dispatchEvent(createMouseEvent('mousemove', 400, 300));
      document.dispatchEvent(createMouseEvent('mouseup', 400, 300));

      expect(saveSettings).toHaveBeenCalledWith({ sidebarSize: 400 });
    });

    it('does not persist size when persistSize is false', async () => {
      const { saveSettings } = await import('../../../../src/shared/settings');
      (saveSettings as ReturnType<typeof vi.fn>).mockClear();

      startDrag(
        { position: 'right', currentSize: 300, onResize, persistSize: false },
        500,
        300,
      );

      document.dispatchEvent(createMouseEvent('mousemove', 400, 300));
      document.dispatchEvent(createMouseEvent('mouseup', 400, 300));

      expect(saveSettings).not.toHaveBeenCalled();
    });

    it('handles multiple consecutive mousemove events', () => {
      startDrag(
        { position: 'left', currentSize: 300, onResize, persistSize: false },
        200,
        300,
      );

      document.dispatchEvent(createMouseEvent('mousemove', 220, 300));
      expect(onResize).toHaveBeenLastCalledWith(320); // 300 + 20

      document.dispatchEvent(createMouseEvent('mousemove', 250, 300));
      expect(onResize).toHaveBeenLastCalledWith(350); // 300 + 50

      document.dispatchEvent(createMouseEvent('mousemove', 210, 300));
      expect(onResize).toHaveBeenLastCalledWith(310); // 300 + 10

      expect(onResize).toHaveBeenCalledTimes(3);
    });
  });
});
