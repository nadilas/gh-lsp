import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getLineNumber,
  getCharacterOffset,
  calculateTextOffset,
  createTokenDetector,
  type TokenHoverEvent,
} from '../../../src/content/token-detector';

// Helper to advance timers
function advanceTimers(ms: number): void {
  vi.advanceTimersByTime(ms);
}

describe('getLineNumber', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('extracts line number from data-line-number attribute', () => {
    document.body.innerHTML = '<div data-line-number="42" class="react-line-row">code</div>';
    const el = document.querySelector('.react-line-row')!;
    expect(getLineNumber(el)).toBe(42);
  });

  it('extracts line number from sibling in table row', () => {
    document.body.innerHTML = `
      <table><tbody><tr>
        <td class="blob-num" data-line-number="10"></td>
        <td class="blob-code">code</td>
      </tr></tbody></table>
    `;
    const el = document.querySelector('.blob-code')!;
    expect(getLineNumber(el)).toBe(10);
  });

  it('extracts line number from element id (LC pattern)', () => {
    document.body.innerHTML = '<div id="LC15" class="react-line-row">code</div>';
    const el = document.querySelector('.react-line-row')!;
    expect(getLineNumber(el)).toBe(15);
  });

  it('extracts line number from element id (L pattern)', () => {
    document.body.innerHTML = '<div id="L7" class="react-line-row">code</div>';
    const el = document.querySelector('.react-line-row')!;
    expect(getLineNumber(el)).toBe(7);
  });

  it('returns null when no line number can be determined', () => {
    document.body.innerHTML = '<div class="unknown">code</div>';
    const el = document.querySelector('.unknown')!;
    expect(getLineNumber(el)).toBeNull();
  });

  it('handles parent react-line-row with data-line-number on child', () => {
    document.body.innerHTML = `
      <div class="react-line-row">
        <div data-line-number="25"></div>
        <div class="react-file-line">code</div>
      </div>
    `;
    const lineRow = document.querySelector('.react-line-row')!;
    const fileLine = document.querySelector('.react-file-line')!;
    // lineRow finds the child with data-line-number through parent lookup
    expect(getLineNumber(lineRow)).toBe(25);
    // fileLine also finds it via closest(.react-line-row) parent
    expect(getLineNumber(fileLine)).toBe(25);
  });
});

describe('getCharacterOffset', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('uses estimateCharacterOffset when caret APIs unavailable', () => {
    document.body.innerHTML = '<div class="react-file-line" style="font-size: 14px;">const x = 1;</div>';
    const el = document.querySelector('.react-file-line')!;

    // In jsdom, caretRangeFromPoint doesn't exist, so it falls back to estimation
    // The mock getBoundingClientRect returns {left: 0, ...} by default
    const offset = getCharacterOffset(el, 0, 0);
    expect(typeof offset).toBe('number');
    expect(offset).toBeGreaterThanOrEqual(0);
  });

  it('returns 0 for clientX at the element left edge', () => {
    document.body.innerHTML = '<div class="react-file-line">code</div>';
    const el = document.querySelector('.react-file-line')!;

    // getBoundingClientRect in jsdom returns {left: 0, ...}
    // So clientX=0 → relativeX=0 → offset=0
    expect(getCharacterOffset(el, 0, 0)).toBe(0);
  });
});

describe('calculateTextOffset', () => {
  it('calculates offset to a text node within container', () => {
    document.body.innerHTML = '<div id="container"><span>hello</span><span> world</span></div>';
    const container = document.getElementById('container')!;
    // Target: the second text node " world" at offset 3 → total = 5 ("hello") + 3 = 8
    const secondSpan = container.children[1]!;
    const textNode = secondSpan.firstChild!;

    expect(calculateTextOffset(container, textNode, 3)).toBe(8);
  });

  it('calculates offset for first text node', () => {
    document.body.innerHTML = '<div id="container">hello world</div>';
    const container = document.getElementById('container')!;
    const textNode = container.firstChild!;

    expect(calculateTextOffset(container, textNode, 5)).toBe(5);
  });

  it('returns targetOffset when node is not found', () => {
    document.body.innerHTML = '<div id="container">text</div><div id="other">other</div>';
    const container = document.getElementById('container')!;
    const otherNode = document.getElementById('other')!.firstChild!;

    expect(calculateTextOffset(container, otherNode, 2)).toBe(2);
  });
});

describe('createTokenDetector', () => {
  let onHover: ReturnType<typeof vi.fn>;
  let onLeave: ReturnType<typeof vi.fn>;
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <div class="react-code-lines">
        <div class="react-line-row" data-line-number="1">
          <div class="react-file-line">const x = 1;</div>
        </div>
        <div class="react-line-row" data-line-number="2">
          <div class="react-file-line">const y = 2;</div>
        </div>
        <div class="react-line-row" data-line-number="3">
          <div class="react-file-line">const z = x + y;</div>
        </div>
      </div>
      <div class="non-code">other content</div>
    `;
    onHover = vi.fn();
    onLeave = vi.fn();
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    vi.useRealTimers();
  });

  it('fires hover callback after debounce when hovering a code line', () => {
    cleanup = createTokenDetector(onHover, onLeave, { debounceMs: 100 });

    const lineEl = document.querySelector('[data-line-number="1"]')!;
    const innerEl = lineEl.querySelector('.react-file-line')!;

    document.dispatchEvent(
      new MouseEvent('mousemove', {
        bubbles: true,
        clientX: 50,
        clientY: 10,
      }),
    );
    // Need to dispatch from the inner element for event.target
    innerEl.dispatchEvent(
      new MouseEvent('mousemove', {
        bubbles: true,
        clientX: 50,
        clientY: 10,
      }),
    );

    // Before debounce
    expect(onHover).not.toHaveBeenCalled();

    advanceTimers(100);

    expect(onHover).toHaveBeenCalledTimes(1);
    const event = onHover.mock.calls[0]![0] as TokenHoverEvent;
    expect(event.position.line).toBe(0); // 1-based → 0-based
    expect(event.lineElement).toBe(lineEl);
    expect(event.clientX).toBe(50);
    expect(event.clientY).toBe(10);
  });

  it('does not fire hover for non-code elements', () => {
    cleanup = createTokenDetector(onHover, onLeave, { debounceMs: 100 });

    const nonCode = document.querySelector('.non-code')!;
    nonCode.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, clientX: 10, clientY: 10 }),
    );

    advanceTimers(200);

    expect(onHover).not.toHaveBeenCalled();
  });

  it('fires leave callback when moving from code to non-code area', () => {
    cleanup = createTokenDetector(onHover, onLeave, { debounceMs: 50 });

    // First, hover over a code line
    const lineEl = document.querySelector('.react-file-line')!;
    lineEl.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, clientX: 50, clientY: 10 }),
    );
    advanceTimers(50);
    expect(onHover).toHaveBeenCalledTimes(1);

    // Then move to non-code area
    const nonCode = document.querySelector('.non-code')!;
    nonCode.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, clientX: 50, clientY: 200 }),
    );

    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it('debounces rapid mouse movements', () => {
    cleanup = createTokenDetector(onHover, onLeave, { debounceMs: 100 });

    const line1 = document.querySelector('[data-line-number="1"] .react-file-line')!;
    const line2 = document.querySelector('[data-line-number="2"] .react-file-line')!;
    const line3 = document.querySelector('[data-line-number="3"] .react-file-line')!;

    // Rapid mouse movements
    line1.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 10, clientY: 10 }));
    advanceTimers(30);
    line2.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 10, clientY: 20 }));
    advanceTimers(30);
    line3.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 10, clientY: 30 }));

    // Wait for debounce
    advanceTimers(100);

    // Only the last position should have fired
    expect(onHover).toHaveBeenCalledTimes(1);
    const event = onHover.mock.calls[0]![0] as TokenHoverEvent;
    expect(event.position.line).toBe(2); // Line 3, 0-based
  });

  it('does not fire again for same position', () => {
    cleanup = createTokenDetector(onHover, onLeave, { debounceMs: 50 });

    const lineEl = document.querySelector('[data-line-number="1"] .react-file-line')!;

    // First hover
    lineEl.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 50, clientY: 10 }));
    advanceTimers(50);
    expect(onHover).toHaveBeenCalledTimes(1);

    // Same element, same position → should not fire again
    lineEl.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 50, clientY: 10 }));
    advanceTimers(50);
    expect(onHover).toHaveBeenCalledTimes(1);
  });

  it('fires leave callback on document mouseleave', () => {
    cleanup = createTokenDetector(onHover, onLeave, { debounceMs: 50 });

    // Hover over code
    const lineEl = document.querySelector('.react-file-line')!;
    lineEl.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 50, clientY: 10 }));
    advanceTimers(50);

    // Mouse leaves document
    document.dispatchEvent(new Event('mouseleave'));

    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it('cleans up listeners on cleanup', () => {
    cleanup = createTokenDetector(onHover, onLeave, { debounceMs: 50 });
    cleanup();
    cleanup = undefined;

    const lineEl = document.querySelector('.react-file-line')!;
    lineEl.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 50, clientY: 10 }));
    advanceTimers(100);

    expect(onHover).not.toHaveBeenCalled();
  });

  it('uses default debounce of 300ms', () => {
    cleanup = createTokenDetector(onHover, onLeave); // No options

    const lineEl = document.querySelector('.react-file-line')!;
    lineEl.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 50, clientY: 10 }));

    advanceTimers(200);
    expect(onHover).not.toHaveBeenCalled();

    advanceTimers(100);
    expect(onHover).toHaveBeenCalledTimes(1);
  });

  it('does not fire leave if no hover occurred', () => {
    cleanup = createTokenDetector(onHover, onLeave, { debounceMs: 50 });

    // Move directly to non-code
    const nonCode = document.querySelector('.non-code')!;
    nonCode.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 10, clientY: 10 }));

    expect(onLeave).not.toHaveBeenCalled();
  });

  it('cancels pending debounce on leave', () => {
    cleanup = createTokenDetector(onHover, onLeave, { debounceMs: 100 });

    // Start hovering
    const lineEl = document.querySelector('.react-file-line')!;
    lineEl.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 50, clientY: 10 }));

    // Leave before debounce fires
    advanceTimers(50);
    const nonCode = document.querySelector('.non-code')!;
    nonCode.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 50, clientY: 200 }));

    advanceTimers(100);

    // Hover should not have fired
    expect(onHover).not.toHaveBeenCalled();
    expect(onLeave).toHaveBeenCalledTimes(1);
  });
});
