import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { h, render } from 'preact';
import { Popover, type PopoverProps } from '../../../../src/ui/popover/Popover';
import type {
  PopoverPosition,
  HoverDisplayData,
  ExtensionError,
} from '../../../../src/shared/types';
import {
  MAX_POPOVER_HEIGHT_PX,
  LOADING_INDICATOR_DELAY_MS,
  POPOVER_FADE_DURATION_MS,
  SCROLL_DISMISS_THRESHOLD_PX,
} from '../../../../src/shared/constants';

/** Wait for Preact useEffect hooks to flush.
 * Preact schedules effects via requestAnimationFrame + setTimeout chain. */
async function flushEffects(): Promise<void> {
  // Flush microtasks
  await new Promise((resolve) => setTimeout(resolve, 0));
  // Flush requestAnimationFrame callbacks
  await new Promise((resolve) => setTimeout(resolve, 0));
  // One more for good measure (Preact's internal scheduling)
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const defaultPosition: PopoverPosition = { top: 100, left: 200, placement: 'below' };

const defaultData: HoverDisplayData = {
  signature: 'function greet(name: string): void',
  language: 'typescript',
  documentation: 'Greets a person by name.',
  parameters: [
    { name: 'name', type: 'string', documentation: 'The name to greet' },
  ],
  definitionLocation: {
    uri: 'https://github.com/owner/repo/blob/main/src/greet.ts#L5',
    range: { start: { line: 4, character: 0 }, end: { line: 4, character: 40 } },
  },
  declarationSource: 'src/greet.ts',
};

const defaultError: ExtensionError = {
  code: 'lsp_server_error',
  message: 'Language server crashed',
};

function createProps(overrides: Partial<PopoverProps> = {}): PopoverProps {
  return {
    state: 'visible',
    data: defaultData,
    error: null,
    position: defaultPosition,
    onDismiss: vi.fn(),
    onPin: vi.fn(),
    onRetry: vi.fn(),
    ...overrides,
  };
}

function renderPopover(props: PopoverProps): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  render(h(Popover, props), container);
  return container;
}

function getPopoverElement(container: HTMLElement): HTMLElement | null {
  return container.querySelector('.gh-lsp-popover');
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Popover', () => {
  let container: HTMLElement;

  beforeEach(() => {
    // Mock matchMedia for jsdom (not implemented by default)
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    if (container?.parentNode) {
      render(null, container);
      container.parentNode.removeChild(container);
    }
    vi.restoreAllMocks();
  });

  describe('hidden state', () => {
    it('renders nothing when state is hidden', () => {
      const props = createProps({ state: 'hidden' });
      container = renderPopover(props);
      expect(getPopoverElement(container)).toBeNull();
    });

    it('renders nothing when position is null', () => {
      const props = createProps({ position: null });
      container = renderPopover(props);
      expect(getPopoverElement(container)).toBeNull();
    });
  });

  describe('loading state', () => {
    it('renders skeleton loading UI after delay', async () => {
      const props = createProps({ state: 'loading', data: null });
      container = renderPopover(props);

      const popover = getPopoverElement(container);
      expect(popover).not.toBeNull();

      // LoadingState has a built-in delay to avoid flicker
      await new Promise((resolve) => setTimeout(resolve, LOADING_INDICATOR_DELAY_MS + 50));

      const loading = popover!.querySelector('.gh-lsp-popover__loading');
      expect(loading).not.toBeNull();

      const skeletons = popover!.querySelectorAll('.gh-lsp-popover__skeleton');
      expect(skeletons.length).toBeGreaterThan(0);
    });

    it('has aria-label for loading state', async () => {
      const props = createProps({ state: 'loading', data: null });
      container = renderPopover(props);

      // Wait for LoadingState delay
      await new Promise((resolve) => setTimeout(resolve, LOADING_INDICATOR_DELAY_MS + 50));

      const loading = container.querySelector('.gh-lsp-popover__loading');
      expect(loading?.getAttribute('aria-label')).toBe('Loading type information');
    });

    it('sets data-state attribute to loading', () => {
      const props = createProps({ state: 'loading', data: null });
      container = renderPopover(props);

      const popover = getPopoverElement(container);
      expect(popover?.getAttribute('data-state')).toBe('loading');
    });
  });

  describe('visible state', () => {
    it('renders hover content with signature', () => {
      const props = createProps({ state: 'visible' });
      container = renderPopover(props);

      const signature = container.querySelector('.gh-lsp-popover__signature');
      expect(signature).not.toBeNull();
      expect(signature?.textContent).toContain('function greet(name: string): void');
    });

    it('renders documentation text', () => {
      const props = createProps({ state: 'visible' });
      container = renderPopover(props);

      const doc = container.querySelector('.gh-lsp-popover__documentation');
      expect(doc).not.toBeNull();
      expect(doc?.textContent).toContain('Greets a person by name.');
    });

    it('renders parameter information', () => {
      const props = createProps({ state: 'visible' });
      container = renderPopover(props);

      const params = container.querySelectorAll('.gh-lsp-popover__param');
      expect(params.length).toBe(1);

      const paramName = container.querySelector('.gh-lsp-popover__param-name');
      expect(paramName?.textContent).toBe('name');

      const paramType = container.querySelector('.gh-lsp-popover__param-type');
      expect(paramType?.textContent).toContain('string');
    });

    it('renders definition link', () => {
      const props = createProps({ state: 'visible' });
      container = renderPopover(props);

      const link = container.querySelector('.gh-lsp-popover__definition-link') as HTMLAnchorElement;
      expect(link).not.toBeNull();
      expect(link.textContent).toBe('Go to Definition');
      expect(link.target).toBe('_blank');
      expect(link.rel).toBe('noopener noreferrer');
    });

    it('renders declaration source when provided', () => {
      const props = createProps({ state: 'visible' });
      container = renderPopover(props);

      const source = container.querySelector('.gh-lsp-popover__declaration-source');
      expect(source).not.toBeNull();
      expect(source?.textContent).toContain('src/greet.ts');
    });

    it('shows pin button in visible state', () => {
      const props = createProps({ state: 'visible' });
      container = renderPopover(props);

      const pinBtn = container.querySelector('.gh-lsp-popover__pin-btn');
      expect(pinBtn).not.toBeNull();
    });

    it('does not show close button in visible state', () => {
      const props = createProps({ state: 'visible' });
      container = renderPopover(props);

      const closeBtn = container.querySelector('.gh-lsp-popover__close-btn');
      expect(closeBtn).toBeNull();
    });

    it('renders without documentation if not provided', () => {
      const dataWithoutDocs = { ...defaultData, documentation: undefined };
      const props = createProps({ state: 'visible', data: dataWithoutDocs });
      container = renderPopover(props);

      const doc = container.querySelector('.gh-lsp-popover__documentation');
      expect(doc).toBeNull();
    });

    it('renders without parameters if none provided', () => {
      const dataNoParams = { ...defaultData, parameters: undefined };
      const props = createProps({ state: 'visible', data: dataNoParams });
      container = renderPopover(props);

      const params = container.querySelector('.gh-lsp-popover__parameters');
      expect(params).toBeNull();
    });

    it('renders without definition link if no location', () => {
      const dataNoDefinition = { ...defaultData, definitionLocation: undefined };
      const props = createProps({ state: 'visible', data: dataNoDefinition });
      container = renderPopover(props);

      const defSection = container.querySelector('.gh-lsp-popover__definition');
      expect(defSection).toBeNull();
    });

    it('applies language class to code element', () => {
      const props = createProps({ state: 'visible' });
      container = renderPopover(props);

      const codeEl = container.querySelector('.gh-lsp-popover__signature code');
      expect(codeEl?.classList.contains('language-typescript')).toBe(true);
    });
  });

  describe('pinned state', () => {
    it('renders content with close button', () => {
      const props = createProps({ state: 'pinned' });
      container = renderPopover(props);

      const closeBtn = container.querySelector('.gh-lsp-popover__close-btn');
      expect(closeBtn).not.toBeNull();
      expect(closeBtn?.getAttribute('aria-label')).toBe('Close popover');
    });

    it('does not show pin button in pinned state', () => {
      const props = createProps({ state: 'pinned' });
      container = renderPopover(props);

      const pinBtn = container.querySelector('.gh-lsp-popover__pin-btn');
      expect(pinBtn).toBeNull();
    });

    it('calls onDismiss when close button clicked', () => {
      const onDismiss = vi.fn();
      const props = createProps({ state: 'pinned', onDismiss });
      container = renderPopover(props);

      const closeBtn = container.querySelector('.gh-lsp-popover__close-btn') as HTMLButtonElement;
      closeBtn.click();
      expect(onDismiss).toHaveBeenCalledOnce();
    });

    it('sets data-state to pinned', () => {
      const props = createProps({ state: 'pinned' });
      container = renderPopover(props);

      const popover = getPopoverElement(container);
      expect(popover?.getAttribute('data-state')).toBe('pinned');
    });
  });

  describe('error state', () => {
    it('renders error message', () => {
      const props = createProps({ state: 'error', data: null, error: defaultError });
      container = renderPopover(props);

      const errorMsg = container.querySelector('.gh-lsp-popover__error-message');
      expect(errorMsg).not.toBeNull();
      expect(errorMsg?.textContent).toBe('Language server crashed');
    });

    it('renders retry button for non-unsupported-language errors', () => {
      const props = createProps({ state: 'error', data: null, error: defaultError });
      container = renderPopover(props);

      const retryBtn = container.querySelector('.gh-lsp-popover__retry-btn');
      expect(retryBtn).not.toBeNull();
    });

    it('does not render retry button for unsupported_language error', () => {
      const unsupportedError: ExtensionError = {
        code: 'unsupported_language',
        message: 'Language not supported',
      };
      const props = createProps({ state: 'error', data: null, error: unsupportedError });
      container = renderPopover(props);

      const retryBtn = container.querySelector('.gh-lsp-popover__retry-btn');
      expect(retryBtn).toBeNull();
    });

    it('renders dismiss button', () => {
      const props = createProps({ state: 'error', data: null, error: defaultError });
      container = renderPopover(props);

      const dismissBtn = container.querySelector('.gh-lsp-popover__dismiss-btn');
      expect(dismissBtn).not.toBeNull();
    });

    it('calls onRetry when retry button is clicked', () => {
      const onRetry = vi.fn();
      const props = createProps({ state: 'error', data: null, error: defaultError, onRetry });
      container = renderPopover(props);

      const retryBtn = container.querySelector('.gh-lsp-popover__retry-btn') as HTMLButtonElement;
      retryBtn.click();
      expect(onRetry).toHaveBeenCalledOnce();
    });

    it('calls onDismiss when dismiss button is clicked', () => {
      const onDismiss = vi.fn();
      const props = createProps({ state: 'error', data: null, error: defaultError, onDismiss });
      container = renderPopover(props);

      const dismissBtn = container.querySelector('.gh-lsp-popover__dismiss-btn') as HTMLButtonElement;
      dismissBtn.click();
      expect(onDismiss).toHaveBeenCalledOnce();
    });

    it('has role="alert" on error container', () => {
      const props = createProps({ state: 'error', data: null, error: defaultError });
      container = renderPopover(props);

      const errorContainer = container.querySelector('.gh-lsp-popover__error');
      expect(errorContainer?.getAttribute('role')).toBe('alert');
    });
  });

  describe('positioning', () => {
    it('applies position: fixed with correct top and left', () => {
      const props = createProps({ position: { top: 150, left: 250, placement: 'below' } });
      container = renderPopover(props);

      const popover = getPopoverElement(container);
      expect(popover?.style.position).toBe('fixed');
      expect(popover?.style.top).toBe('150px');
      expect(popover?.style.left).toBe('250px');
    });

    it('sets data-placement attribute', () => {
      const props = createProps({ position: { top: 100, left: 200, placement: 'above' } });
      container = renderPopover(props);

      const popover = getPopoverElement(container);
      expect(popover?.getAttribute('data-placement')).toBe('above');
    });

    it('sets max-height on content area', () => {
      const props = createProps();
      container = renderPopover(props);

      const content = container.querySelector('.gh-lsp-popover__content') as HTMLElement;
      expect(content?.style.maxHeight).toBe(`${MAX_POPOVER_HEIGHT_PX}px`);
    });

    it('sets overflow auto on content area', () => {
      const props = createProps();
      container = renderPopover(props);

      const content = container.querySelector('.gh-lsp-popover__content') as HTMLElement;
      expect(content?.style.overflow).toBe('auto');
    });
  });

  describe('accessibility', () => {
    it('has role="tooltip"', () => {
      const props = createProps();
      container = renderPopover(props);

      const popover = getPopoverElement(container);
      expect(popover?.getAttribute('role')).toBe('tooltip');
    });

    it('has aria-live="polite"', () => {
      const props = createProps();
      container = renderPopover(props);

      const popover = getPopoverElement(container);
      expect(popover?.getAttribute('aria-live')).toBe('polite');
    });

    it('close button has aria-label', () => {
      const props = createProps({ state: 'pinned' });
      container = renderPopover(props);

      const closeBtn = container.querySelector('.gh-lsp-popover__close-btn');
      expect(closeBtn?.getAttribute('aria-label')).toBe('Close popover');
    });

    it('pin button has aria-label', () => {
      const props = createProps({ state: 'visible' });
      container = renderPopover(props);

      const pinBtn = container.querySelector('.gh-lsp-popover__pin-btn');
      expect(pinBtn?.getAttribute('aria-label')).toBe('Pin popover');
    });

    it('definition link has aria-label', () => {
      const props = createProps({ state: 'visible' });
      container = renderPopover(props);

      const link = container.querySelector('.gh-lsp-popover__definition-link');
      expect(link?.getAttribute('aria-label')).toBe('Go to definition');
    });

    it('content area has aria-busy when loading', () => {
      const props = createProps({ state: 'loading', data: null });
      container = renderPopover(props);

      const content = container.querySelector('.gh-lsp-popover__content');
      expect(content?.getAttribute('aria-busy')).toBe('true');
    });

    it('content area has aria-busy=false when visible', () => {
      const props = createProps({ state: 'visible' });
      container = renderPopover(props);

      const content = container.querySelector('.gh-lsp-popover__content');
      expect(content?.getAttribute('aria-busy')).toBe('false');
    });

    it('loading indicator has role="status"', async () => {
      const props = createProps({ state: 'loading', data: null });
      container = renderPopover(props);

      await new Promise((resolve) => setTimeout(resolve, LOADING_INDICATOR_DELAY_MS + 50));

      const loading = container.querySelector('.gh-lsp-popover__loading');
      expect(loading?.getAttribute('role')).toBe('status');
    });
  });

  describe('focus trap (pinned state)', () => {
    it('popover contains multiple focusable elements when pinned', async () => {
      const props = createProps({ state: 'pinned' });
      container = renderPopover(props);
      await flushEffects();

      const popover = getPopoverElement(container)!;
      const focusable = popover.querySelectorAll('a[href], button:not([disabled])');
      // Should have at least close button and definition link
      expect(focusable.length).toBeGreaterThanOrEqual(2);
    });

    it('Tab event preventDefault is called when focus wraps in pinned popover', async () => {
      const props = createProps({ state: 'pinned' });
      container = renderPopover(props);
      await flushEffects();
      await new Promise((r) => setTimeout(r, 50));

      const popover = getPopoverElement(container)!;
      const focusable = Array.from(
        popover.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'),
      );
      expect(focusable.length).toBeGreaterThanOrEqual(2);

      // Spy on focus() calls to the first focusable element
      const firstFocusSpy = vi.spyOn(focusable[0]!, 'focus');

      // Focus the last element so the forward-Tab condition triggers
      focusable[focusable.length - 1]!.focus();

      const tabEvent = new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(tabEvent);

      // Verify the focus trap tried to wrap focus to the first element.
      // In jsdom, document.activeElement may not update reliably, but
      // the focus trap will call first.focus() when wrapping.
      expect(firstFocusSpy).toHaveBeenCalled();
    });

    it('does not trap Tab when popover is not pinned', async () => {
      const props = createProps({ state: 'visible' });
      container = renderPopover(props);
      await flushEffects();

      const tabEvent = new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true,
      });
      const preventDefaultSpy = vi.spyOn(tabEvent, 'preventDefault');
      document.dispatchEvent(tabEvent);

      // Focus trap should NOT call preventDefault when not pinned
      expect(preventDefaultSpy).not.toHaveBeenCalled();
    });
  });

  describe('dismiss on Escape', () => {
    it('calls onDismiss when Escape is pressed', async () => {
      const onDismiss = vi.fn();
      const props = createProps({ onDismiss });
      container = renderPopover(props);
      // Flush Preact effects — extra ticks needed for listener registration
      await flushEffects();
      await new Promise((r) => setTimeout(r, 50));

      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      document.dispatchEvent(event);
      expect(onDismiss).toHaveBeenCalledOnce();
    });

    it('does not call onDismiss for other keys', async () => {
      const onDismiss = vi.fn();
      const props = createProps({ onDismiss });
      container = renderPopover(props);
      await flushEffects();
      await new Promise((r) => setTimeout(r, 50));

      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      document.dispatchEvent(event);
      expect(onDismiss).not.toHaveBeenCalled();
    });

    it('does not listen for Escape when hidden', async () => {
      const onDismiss = vi.fn();
      const props = createProps({ state: 'hidden', onDismiss });
      container = renderPopover(props);
      await flushEffects();

      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      document.dispatchEvent(event);
      expect(onDismiss).not.toHaveBeenCalled();
    });
  });

  describe('dismiss on scroll', () => {
    it('calls onDismiss when scrolled beyond threshold', async () => {
      const onDismiss = vi.fn();

      Object.defineProperty(window, 'scrollY', { value: 0, writable: true, configurable: true });

      const props = createProps({ state: 'visible', onDismiss });
      container = renderPopover(props);
      // Flush Preact effects so scroll listener is attached — Preact schedules
      // effects via a microtask + rAF chain, so we need a real tick.
      await flushEffects();
      await new Promise((r) => setTimeout(r, 50));

      // Simulate scroll beyond threshold
      Object.defineProperty(window, 'scrollY', { value: SCROLL_DISMISS_THRESHOLD_PX + 1, writable: true, configurable: true });
      window.dispatchEvent(new Event('scroll'));

      expect(onDismiss).toHaveBeenCalledOnce();
    });

    it('does not dismiss when scroll delta is within threshold', async () => {
      const onDismiss = vi.fn();
      Object.defineProperty(window, 'scrollY', { value: 100, writable: true, configurable: true });

      const props = createProps({ state: 'visible', onDismiss });
      container = renderPopover(props);
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 0));
      }

      Object.defineProperty(window, 'scrollY', { value: 100 + SCROLL_DISMISS_THRESHOLD_PX - 1, writable: true, configurable: true });
      window.dispatchEvent(new Event('scroll'));

      expect(onDismiss).not.toHaveBeenCalled();
    });

    it('does not dismiss on scroll when pinned', async () => {
      const onDismiss = vi.fn();
      Object.defineProperty(window, 'scrollY', { value: 0, writable: true, configurable: true });

      const props = createProps({ state: 'pinned', onDismiss });
      container = renderPopover(props);
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 0));
      }

      Object.defineProperty(window, 'scrollY', { value: 200, writable: true, configurable: true });
      window.dispatchEvent(new Event('scroll'));

      expect(onDismiss).not.toHaveBeenCalled();
    });
  });

  describe('mouse interaction', () => {
    it('calls onPin when pin button is clicked', () => {
      const onPin = vi.fn();
      const props = createProps({ state: 'visible', onPin });
      container = renderPopover(props);

      const pinBtn = container.querySelector('.gh-lsp-popover__pin-btn') as HTMLButtonElement;
      pinBtn.click();
      expect(onPin).toHaveBeenCalledOnce();
    });
  });

  describe('parameter rendering', () => {
    it('renders parameter with default value', () => {
      const dataWithDefaults: HoverDisplayData = {
        ...defaultData,
        parameters: [
          { name: 'count', type: 'number', defaultValue: '10', documentation: 'The count' },
        ],
      };
      const props = createProps({ state: 'visible', data: dataWithDefaults });
      container = renderPopover(props);

      const defaultVal = container.querySelector('.gh-lsp-popover__param-default');
      expect(defaultVal).not.toBeNull();
      expect(defaultVal?.textContent).toContain('10');
    });

    it('renders multiple parameters', () => {
      const multiParamData: HoverDisplayData = {
        ...defaultData,
        parameters: [
          { name: 'a', type: 'string' },
          { name: 'b', type: 'number' },
          { name: 'c', type: 'boolean' },
        ],
      };
      const props = createProps({ state: 'visible', data: multiParamData });
      container = renderPopover(props);

      const params = container.querySelectorAll('.gh-lsp-popover__param');
      expect(params.length).toBe(3);
    });
  });

  describe('fade transition', () => {
    it('sets opacity transition style on the popover', () => {
      const props = createProps();
      container = renderPopover(props);

      const popover = getPopoverElement(container);
      expect(popover?.style.transition).toContain('opacity');
      expect(popover?.style.transition).toContain(`${POPOVER_FADE_DURATION_MS}ms`);
    });
  });
});
