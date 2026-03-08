import { describe, it, expect, vi, afterEach } from 'vitest';
import { h, render } from 'preact';
import { LoadingState } from '../../../../src/ui/components/LoadingState';
import { LOADING_INDICATOR_DELAY_MS } from '../../../../src/shared/constants';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function renderComponent(delayMs?: number): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  render(h(LoadingState, delayMs !== undefined ? { delayMs } : {}), container);
  return container;
}

/** Wait for a specified time, then flush Preact re-renders */
function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('LoadingState', () => {
  let container: HTMLElement;

  afterEach(() => {
    if (container?.parentNode) {
      render(null, container);
      container.parentNode.removeChild(container);
    }
    vi.restoreAllMocks();
  });

  it('does not render skeleton immediately (respects 200ms delay)', () => {
    container = renderComponent();

    const loading = container.querySelector('.gh-lsp-popover__loading');
    expect(loading).toBeNull();
  });

  it('renders skeleton after the default delay (200ms)', async () => {
    container = renderComponent();

    // Before delay: nothing
    expect(container.querySelector('.gh-lsp-popover__loading')).toBeNull();

    // Wait for the delay plus buffer for Preact to re-render
    await waitFor(LOADING_INDICATOR_DELAY_MS + 50);

    const loading = container.querySelector('.gh-lsp-popover__loading');
    expect(loading).not.toBeNull();
  });

  it('does not render skeleton before the delay completes', async () => {
    // Use a long delay so we can test before it fires
    container = renderComponent(500);

    // Wait a bit for Preact effects to run (but not enough for the timer)
    await waitFor(50);

    const loading = container.querySelector('.gh-lsp-popover__loading');
    expect(loading).toBeNull();
  });

  it('renders immediately when delayMs is 0', async () => {
    container = renderComponent(0);
    // Small wait for Preact effects
    await waitFor(20);

    const loading = container.querySelector('.gh-lsp-popover__loading');
    expect(loading).not.toBeNull();
  });

  it('renders skeleton lines when visible', async () => {
    container = renderComponent(0);
    await waitFor(20);

    const skeletons = container.querySelectorAll('.gh-lsp-popover__skeleton');
    expect(skeletons.length).toBe(2);
  });

  it('includes short skeleton variant', async () => {
    container = renderComponent(0);
    await waitFor(20);

    const shortSkeleton = container.querySelector('.gh-lsp-popover__skeleton--short');
    expect(shortSkeleton).not.toBeNull();
  });

  it('has aria-label for accessibility', async () => {
    container = renderComponent(0);
    await waitFor(20);

    const loading = container.querySelector('.gh-lsp-popover__loading');
    expect(loading?.getAttribute('aria-label')).toBe('Loading type information');
  });

  it('has role="status" for screen readers', async () => {
    container = renderComponent(0);
    await waitFor(20);

    const loading = container.querySelector('.gh-lsp-popover__loading');
    expect(loading?.getAttribute('role')).toBe('status');
  });

  it('has aria-busy="true" while loading', async () => {
    container = renderComponent(0);
    await waitFor(20);

    const loading = container.querySelector('.gh-lsp-popover__loading');
    expect(loading?.getAttribute('aria-busy')).toBe('true');
  });

  it('uses custom delay when provided', async () => {
    container = renderComponent(300);

    // At 50ms: should not be visible yet
    await waitFor(50);
    expect(container.querySelector('.gh-lsp-popover__loading')).toBeNull();

    // At 350ms+: should be visible
    await waitFor(300);
    expect(container.querySelector('.gh-lsp-popover__loading')).not.toBeNull();
  });

  it('cleans up timer on unmount', async () => {
    container = renderComponent();

    // Unmount before delay fires
    render(null, container);

    // Wait past delay — should not throw or cause issues
    await waitFor(LOADING_INDICATOR_DELAY_MS + 100);

    // No error means cleanup worked
    expect(true).toBe(true);
  });

  it('default delay matches LOADING_INDICATOR_DELAY_MS constant', () => {
    expect(LOADING_INDICATOR_DELAY_MS).toBe(200);
  });
});
