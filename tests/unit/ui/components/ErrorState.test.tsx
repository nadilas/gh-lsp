import { describe, it, expect, vi, afterEach } from 'vitest';
import { h, render } from 'preact';
import { ErrorState, type ErrorStateProps } from '../../../../src/ui/components/ErrorState';
import type { ExtensionError } from '../../../../src/shared/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function renderComponent(props: ErrorStateProps): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  render(h(ErrorState, props), container);
  return container;
}

const serverError: ExtensionError = {
  code: 'lsp_server_error',
  message: 'Language server crashed',
};

const unsupportedError: ExtensionError = {
  code: 'unsupported_language',
  message: 'Language not supported',
};

const timeoutError: ExtensionError = {
  code: 'lsp_timeout',
  message: 'Request timed out',
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ErrorState', () => {
  let container: HTMLElement;

  afterEach(() => {
    if (container?.parentNode) {
      render(null, container);
      container.parentNode.removeChild(container);
    }
    vi.restoreAllMocks();
  });

  it('renders error message text', () => {
    container = renderComponent({
      error: serverError,
      onDismiss: vi.fn(),
    });

    const msg = container.querySelector('.gh-lsp-popover__error-message');
    expect(msg).not.toBeNull();
    expect(msg?.textContent).toBe('Language server crashed');
  });

  it('has role="alert" for accessibility', () => {
    container = renderComponent({
      error: serverError,
      onDismiss: vi.fn(),
    });

    const errorEl = container.querySelector('.gh-lsp-popover__error');
    expect(errorEl?.getAttribute('role')).toBe('alert');
  });

  it('renders retry button for lsp_server_error when onRetry provided', () => {
    const onRetry = vi.fn();
    container = renderComponent({
      error: serverError,
      onRetry,
      onDismiss: vi.fn(),
    });

    const retryBtn = container.querySelector('.gh-lsp-popover__retry-btn') as HTMLButtonElement;
    expect(retryBtn).not.toBeNull();
    expect(retryBtn.textContent).toBe('Retry');
  });

  it('calls onRetry when retry button is clicked', () => {
    const onRetry = vi.fn();
    container = renderComponent({
      error: serverError,
      onRetry,
      onDismiss: vi.fn(),
    });

    const retryBtn = container.querySelector('.gh-lsp-popover__retry-btn') as HTMLButtonElement;
    retryBtn.click();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('does not render retry button for unsupported_language error', () => {
    container = renderComponent({
      error: unsupportedError,
      onRetry: vi.fn(),
      onDismiss: vi.fn(),
    });

    const retryBtn = container.querySelector('.gh-lsp-popover__retry-btn');
    expect(retryBtn).toBeNull();
  });

  it('does not render retry button when onRetry is not provided', () => {
    container = renderComponent({
      error: serverError,
      onDismiss: vi.fn(),
    });

    const retryBtn = container.querySelector('.gh-lsp-popover__retry-btn');
    expect(retryBtn).toBeNull();
  });

  it('always renders dismiss button', () => {
    container = renderComponent({
      error: serverError,
      onDismiss: vi.fn(),
    });

    const dismissBtn = container.querySelector('.gh-lsp-popover__dismiss-btn');
    expect(dismissBtn).not.toBeNull();
    expect(dismissBtn?.textContent).toBe('Dismiss');
  });

  it('calls onDismiss when dismiss button is clicked', () => {
    const onDismiss = vi.fn();
    container = renderComponent({
      error: serverError,
      onDismiss,
    });

    const dismissBtn = container.querySelector('.gh-lsp-popover__dismiss-btn') as HTMLButtonElement;
    dismissBtn.click();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('renders retry button for timeout errors', () => {
    container = renderComponent({
      error: timeoutError,
      onRetry: vi.fn(),
      onDismiss: vi.fn(),
    });

    const retryBtn = container.querySelector('.gh-lsp-popover__retry-btn');
    expect(retryBtn).not.toBeNull();
  });

  it('retry button has aria-label', () => {
    container = renderComponent({
      error: serverError,
      onRetry: vi.fn(),
      onDismiss: vi.fn(),
    });

    const retryBtn = container.querySelector('.gh-lsp-popover__retry-btn');
    expect(retryBtn?.getAttribute('aria-label')).toBe('Retry');
  });

  it('dismiss button has aria-label', () => {
    container = renderComponent({
      error: serverError,
      onDismiss: vi.fn(),
    });

    const dismissBtn = container.querySelector('.gh-lsp-popover__dismiss-btn');
    expect(dismissBtn?.getAttribute('aria-label')).toBe('Dismiss error');
  });

  it('renders dismiss button for unsupported_language (dismissible info message)', () => {
    container = renderComponent({
      error: unsupportedError,
      onDismiss: vi.fn(),
    });

    const dismissBtn = container.querySelector('.gh-lsp-popover__dismiss-btn');
    expect(dismissBtn).not.toBeNull();

    // No retry button
    const retryBtn = container.querySelector('.gh-lsp-popover__retry-btn');
    expect(retryBtn).toBeNull();
  });
});
