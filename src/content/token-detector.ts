import type { LspPosition } from '../shared/types';
import { DEFAULT_HOVER_DEBOUNCE_MS } from '../shared/constants';

/**
 * Information about a detected hover token position.
 */
export interface TokenHoverEvent {
  /** LSP position (0-indexed line and character) */
  position: LspPosition;
  /** The hovered DOM element (code line element) */
  lineElement: Element;
  /** Mouse coordinates for popover positioning */
  clientX: number;
  clientY: number;
}

export type TokenHoverCallback = (event: TokenHoverEvent) => void;
export type TokenLeaveCallback = () => void;

export interface TokenDetectorOptions {
  /** Debounce delay in ms before triggering a hover event (default: 300ms) */
  debounceMs?: number;
}

// ─── Position Calculation ────────────────────────────────────────────────────

/**
 * GitHub code line selectors and their data attributes for extracting
 * the 1-based line number.
 */
const LINE_NUMBER_SELECTORS = [
  // React blob view: line number is in data-line-number on sibling
  { lineSelector: '.react-line-row', attrSelector: '[data-line-number]', attr: 'data-line-number' },
  // Legacy blob view: blob-num cell holds the line number
  { lineSelector: 'td.blob-code', attrSelector: 'td.blob-num', attr: 'data-line-number' },
  // Diff view: diff line number cell
  { lineSelector: 'td.blob-code', attrSelector: 'td.blob-num', attr: 'data-line-number' },
] as const;

/**
 * Extracts the 1-based line number from a code line element.
 * Returns null if the line number cannot be determined.
 */
export function getLineNumber(lineElement: Element): number | null {
  // Try data-line-number directly on the element
  const directAttr = lineElement.getAttribute('data-line-number');
  if (directAttr) {
    const num = parseInt(directAttr, 10);
    if (!isNaN(num)) return num;
  }

  // Try finding a line number element within the same row
  const parent = lineElement.closest('tr') ?? lineElement.closest('.react-line-row') ?? lineElement.parentElement;
  if (!parent) return null;

  for (const { attr, attrSelector } of LINE_NUMBER_SELECTORS) {
    const numEl = parent.querySelector(attrSelector);
    if (numEl) {
      const val = numEl.getAttribute(attr);
      if (val) {
        const num = parseInt(val, 10);
        if (!isNaN(num)) return num;
      }
    }
  }

  // Try id-based line number (GitHub uses id="LC{n}" or id="L{n}" on line elements)
  const idMatch = lineElement.id?.match(/^L(?:C)?(\d+)$/);
  if (idMatch?.[1]) {
    return parseInt(idMatch[1], 10);
  }

  return null;
}

/**
 * Calculates the character offset within a code line based on mouse position.
 *
 * Uses the browser's Range/caretPositionFromPoint or caretRangeFromPoint API
 * to find the exact character position under the mouse cursor.
 *
 * Returns the 0-indexed character offset, or 0 if the position cannot be determined.
 */
export function getCharacterOffset(
  lineElement: Element,
  clientX: number,
  clientY: number,
): number {
  // Get the code content element within the line
  const codeElement = lineElement.querySelector(
    '.react-file-line, .blob-code-inner, .js-file-line',
  ) ?? lineElement;

  // Try caretRangeFromPoint (Chrome, Safari)
  if (typeof document.caretRangeFromPoint === 'function') {
    const range = document.caretRangeFromPoint(clientX, clientY);
    if (range && codeElement.contains(range.startContainer)) {
      return calculateTextOffset(codeElement, range.startContainer, range.startOffset);
    }
  }

  // Try caretPositionFromPoint (Firefox)
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  if (typeof doc.caretPositionFromPoint === 'function') {
    const pos = doc.caretPositionFromPoint(clientX, clientY);
    if (pos && codeElement.contains(pos.offsetNode)) {
      return calculateTextOffset(codeElement, pos.offsetNode, pos.offset);
    }
  }

  // Fallback: estimate based on character width
  return estimateCharacterOffset(codeElement, clientX);
}

/**
 * Calculates the total text offset from the beginning of a container
 * to a specific node+offset position within it.
 *
 * Walks through text nodes to accumulate the offset.
 */
export function calculateTextOffset(
  container: Node,
  targetNode: Node,
  targetOffset: number,
): number {
  let offset = 0;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);

  let node = walker.nextNode();
  while (node) {
    if (node === targetNode) {
      return offset + targetOffset;
    }
    offset += (node.textContent?.length ?? 0);
    node = walker.nextNode();
  }

  // If target is the container itself or couldn't be found
  return targetOffset;
}

/**
 * Estimates character offset based on monospace font metrics.
 * Fallback for when caret APIs aren't available (e.g., jsdom).
 */
function estimateCharacterOffset(codeElement: Element, clientX: number): number {
  const rect = codeElement.getBoundingClientRect();
  const relativeX = clientX - rect.left;

  // Estimate character width from the computed font-size
  // Monospace characters are roughly 0.6x the font-size
  const style = window.getComputedStyle(codeElement);
  const fontSize = parseFloat(style.fontSize) || 14;
  const charWidth = fontSize * 0.6;

  if (charWidth <= 0) return 0;

  return Math.max(0, Math.floor(relativeX / charWidth));
}

// ─── Hover Debounce and Detection ────────────────────────────────────────────

/**
 * Creates a token detector that listens for mouse events on code lines,
 * debounces them, and calls the appropriate callback.
 *
 * The detector attaches a single mousemove listener on the document
 * and uses event delegation to detect when the mouse hovers over a code line.
 *
 * Returns a cleanup function that removes the listener and clears timers.
 */
export function createTokenDetector(
  onHover: TokenHoverCallback,
  onLeave: TokenLeaveCallback,
  options: TokenDetectorOptions = {},
): () => void {
  const debounceMs = options.debounceMs ?? DEFAULT_HOVER_DEBOUNCE_MS;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastLineElement: Element | null = null;
  let lastPosition: LspPosition | null = null;

  const CODE_LINE_SELECTOR =
    '.react-line-row, .blob-code, .react-diff-line';

  function handleMouseMove(event: MouseEvent) {
    const target = event.target;
    if (!target || !(target instanceof Element)) return;

    // Find the closest code line element
    const lineElement = target.closest(CODE_LINE_SELECTOR);

    if (!lineElement) {
      // Mouse left all code lines
      clearDebounce();
      if (lastLineElement) {
        lastLineElement = null;
        lastPosition = null;
        onLeave();
      }
      return;
    }

    // Get the line number (1-based → convert to 0-based for LSP)
    const lineNum = getLineNumber(lineElement);
    if (lineNum === null) return;

    const line = lineNum - 1; // LSP uses 0-based
    const character = getCharacterOffset(lineElement, event.clientX, event.clientY);
    const position: LspPosition = { line, character };

    // Skip if same position as last hover
    if (
      lastLineElement === lineElement &&
      lastPosition?.line === position.line &&
      lastPosition?.character === position.character
    ) {
      return;
    }

    lastLineElement = lineElement;
    lastPosition = position;

    // Debounce the hover event
    clearDebounce();
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      onHover({
        position,
        lineElement,
        clientX: event.clientX,
        clientY: event.clientY,
      });
    }, debounceMs);
  }

  function handleMouseLeave() {
    clearDebounce();
    if (lastLineElement) {
      lastLineElement = null;
      lastPosition = null;
      onLeave();
    }
  }

  function clearDebounce() {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  }

  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseleave', handleMouseLeave);

  return () => {
    clearDebounce();
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseleave', handleMouseLeave);
    lastLineElement = null;
    lastPosition = null;
  };
}
