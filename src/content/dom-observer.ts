/**
 * DOM observer for GitHub code views.
 *
 * Sets up MutationObservers on GitHub's code containers to detect when code
 * lines are added/removed (e.g., expanding collapsed sections, lazy loading
 * in PR diffs, or virtualized scroll in large files).
 *
 * GitHub's code DOM structure (as of 2024-2025):
 *
 * Blob view:
 *   <div class="react-code-lines"> or <table class="highlight tab-size">
 *     <div class="react-line-row"> (one per line)
 *       <div class="react-file-line"> (line content)
 *
 * PR files / diff view:
 *   <div class="js-diff-progressive-container">
 *     <div class="file" id="diff-{hash}">
 *       <div class="js-file-content">
 *         <table class="diff-table">
 *           <tr class="blob-code"> (one per line)
 *
 * The observer watches for:
 * 1. New code line elements being inserted (childList mutations)
 * 2. Code containers being added/removed (for PR diff lazy loading)
 * 3. Content changes within existing lines (characterData, subtree)
 */

export interface DomObserverCallbacks {
  /** Called when code lines are added to the DOM */
  onLinesAdded: (lines: Element[]) => void;
  /** Called when code lines are removed from the DOM */
  onLinesRemoved: (lines: Element[]) => void;
  /** Called when a new code container (file) is detected */
  onCodeContainerAdded: (container: Element) => void;
}

/** Selectors for GitHub's code container elements */
const CODE_CONTAINER_SELECTORS = [
  // Blob view (React-based new UI)
  '.react-code-lines',
  // Blob view (legacy table-based)
  'table.highlight',
  // PR diff files container
  '.js-diff-progressive-container',
  // Individual diff file content
  '.js-file-content',
  // Code navigation blob content
  '.react-blob-print-hide',
] as const;

/** Selectors for individual code line elements */
const CODE_LINE_SELECTORS = [
  // React blob view lines
  '.react-line-row',
  // Legacy blob view lines
  '.blob-code',
  // Diff table lines
  'tr.blob-code',
  // New react diff lines
  '.react-diff-line',
] as const;

/** Combined selector for matching any code line */
const CODE_LINE_SELECTOR = CODE_LINE_SELECTORS.join(', ');

/** Combined selector for matching any code container */
const CODE_CONTAINER_SELECTOR = CODE_CONTAINER_SELECTORS.join(', ');

/**
 * Finds all existing code containers currently in the document.
 */
export function findCodeContainers(): Element[] {
  return Array.from(document.querySelectorAll(CODE_CONTAINER_SELECTOR));
}

/**
 * Finds all code line elements within a given container.
 */
export function findCodeLines(container: Element): Element[] {
  return Array.from(container.querySelectorAll(CODE_LINE_SELECTOR));
}

/**
 * Checks whether an element is a code line.
 */
export function isCodeLine(element: Element): boolean {
  return element.matches(CODE_LINE_SELECTOR);
}

/**
 * Checks whether an element is a code container.
 */
export function isCodeContainer(element: Element): boolean {
  return element.matches(CODE_CONTAINER_SELECTOR);
}

/**
 * Creates and starts a MutationObserver on the document body that watches
 * for code containers and lines being added or removed.
 *
 * Returns a cleanup function that disconnects the observer.
 */
export function observeCodeDom(callbacks: DomObserverCallbacks): () => void {
  const observer = new MutationObserver((mutations) => {
    const addedLines: Element[] = [];
    const removedLines: Element[] = [];
    const addedContainers: Element[] = [];

    for (const mutation of mutations) {
      if (mutation.type !== 'childList') continue;

      // Check added nodes
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;

        // Check if the added node itself is a code container
        if (isCodeContainer(node)) {
          addedContainers.push(node);
          // Also collect all lines within the new container
          addedLines.push(...findCodeLines(node));
          continue;
        }

        // Check if the added node itself is a code line
        if (isCodeLine(node)) {
          addedLines.push(node);
          continue;
        }

        // Check if the added node contains code containers or lines
        const nestedContainers = node.querySelectorAll(CODE_CONTAINER_SELECTOR);
        for (const container of nestedContainers) {
          addedContainers.push(container);
          addedLines.push(...findCodeLines(container));
        }

        const nestedLines = node.querySelectorAll(CODE_LINE_SELECTOR);
        for (const line of nestedLines) {
          // Avoid double-counting lines already found inside containers
          if (!addedLines.includes(line)) {
            addedLines.push(line);
          }
        }
      }

      // Check removed nodes
      for (const node of mutation.removedNodes) {
        if (!(node instanceof Element)) continue;

        if (isCodeLine(node)) {
          removedLines.push(node);
          continue;
        }

        // If a container was removed, collect its lines as removed
        if (isCodeContainer(node)) {
          removedLines.push(...findCodeLines(node));
          continue;
        }

        const nestedLines = node.querySelectorAll(CODE_LINE_SELECTOR);
        for (const line of nestedLines) {
          removedLines.push(line);
        }
      }
    }

    // Fire callbacks
    if (addedContainers.length > 0) {
      for (const container of addedContainers) {
        callbacks.onCodeContainerAdded(container);
      }
    }
    if (addedLines.length > 0) {
      callbacks.onLinesAdded(addedLines);
    }
    if (removedLines.length > 0) {
      callbacks.onLinesRemoved(removedLines);
    }
  });

  // Observe the entire document body for structural changes
  // Using subtree ensures we catch deeply nested additions (e.g., diff lazy loading)
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  return () => {
    observer.disconnect();
  };
}
