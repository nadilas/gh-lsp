import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { h, render } from 'preact';
import { Sidebar, type SidebarProps } from '../../../../src/ui/sidebar/Sidebar';
import type {
  SidebarPosition,
  HoverDisplayData,
  ExtensionError,
} from '../../../../src/shared/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Wait for Preact useEffect hooks to flush. */
async function flushEffects(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

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

function createProps(overrides: Partial<SidebarProps> = {}): SidebarProps {
  return {
    position: 'right',
    state: 'expanded',
    data: defaultData,
    error: null,
    loading: false,
    onToggle: vi.fn(),
    onRetry: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
  };
}

function renderSidebar(props: SidebarProps): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  render(h(Sidebar, props), container);
  return container;
}

function getSidebarElement(container: HTMLElement): HTMLElement | null {
  return container.querySelector('.gh-lsp-sidebar');
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Sidebar', () => {
  let container: HTMLElement;

  beforeEach(() => {
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
      container = renderSidebar(props);
      expect(getSidebarElement(container)).toBeNull();
    });
  });

  describe('collapsed state', () => {
    it('renders sidebar in collapsed mode', () => {
      const props = createProps({ state: 'collapsed' });
      container = renderSidebar(props);
      const sidebar = getSidebarElement(container);
      expect(sidebar).not.toBeNull();
      expect(sidebar?.getAttribute('data-state')).toBe('collapsed');
    });

    it('shows toggle button when collapsed', () => {
      const props = createProps({ state: 'collapsed' });
      container = renderSidebar(props);
      const toggleBtn = container.querySelector('.gh-lsp-sidebar__toggle-btn');
      expect(toggleBtn).not.toBeNull();
    });

    it('does not show content area when collapsed', () => {
      const props = createProps({ state: 'collapsed' });
      container = renderSidebar(props);
      const content = container.querySelector('.gh-lsp-sidebar__content');
      expect(content).toBeNull();
    });

    it('does not show title when collapsed', () => {
      const props = createProps({ state: 'collapsed' });
      container = renderSidebar(props);
      const title = container.querySelector('.gh-lsp-sidebar__title');
      expect(title).toBeNull();
    });

    it('toggle button has "Expand sidebar" aria-label when collapsed', () => {
      const props = createProps({ state: 'collapsed' });
      container = renderSidebar(props);
      const btn = container.querySelector('.gh-lsp-sidebar__toggle-btn');
      expect(btn?.getAttribute('aria-label')).toBe('Expand sidebar');
    });

    it('does not show resize handle when collapsed', () => {
      const props = createProps({ state: 'collapsed' });
      container = renderSidebar(props);
      const handle = container.querySelector('.gh-lsp-sidebar__resize-handle');
      expect(handle).toBeNull();
    });
  });

  describe('expanded state', () => {
    it('renders sidebar in expanded mode', () => {
      const props = createProps({ state: 'expanded' });
      container = renderSidebar(props);
      const sidebar = getSidebarElement(container);
      expect(sidebar).not.toBeNull();
      expect(sidebar?.getAttribute('data-state')).toBe('expanded');
    });

    it('shows content area when expanded', () => {
      const props = createProps({ state: 'expanded' });
      container = renderSidebar(props);
      const content = container.querySelector('.gh-lsp-sidebar__content');
      expect(content).not.toBeNull();
    });

    it('shows title with symbol name when data is available', () => {
      const props = createProps({ state: 'expanded' });
      container = renderSidebar(props);
      const title = container.querySelector('.gh-lsp-sidebar__title');
      expect(title).not.toBeNull();
      expect(title?.textContent).toBe('function greet');
    });

    it('shows "Code Intelligence" title when no data', () => {
      const props = createProps({ state: 'expanded', data: null });
      container = renderSidebar(props);
      const title = container.querySelector('.gh-lsp-sidebar__title');
      expect(title?.textContent).toBe('Code Intelligence');
    });

    it('toggle button has "Collapse sidebar" aria-label when expanded', () => {
      const props = createProps({ state: 'expanded' });
      container = renderSidebar(props);
      const btn = container.querySelector('.gh-lsp-sidebar__toggle-btn');
      expect(btn?.getAttribute('aria-label')).toBe('Collapse sidebar');
    });

    it('shows resize handle when expanded', () => {
      const props = createProps({ state: 'expanded' });
      container = renderSidebar(props);
      const handle = container.querySelector('.gh-lsp-sidebar__resize-handle');
      expect(handle).not.toBeNull();
    });
  });

  describe('content display', () => {
    it('renders signature display with data', () => {
      const props = createProps({ state: 'expanded' });
      container = renderSidebar(props);
      const signature = container.querySelector('.gh-lsp-popover__signature');
      expect(signature).not.toBeNull();
      expect(signature?.textContent).toContain('function greet(name: string): void');
    });

    it('renders documentation', () => {
      const props = createProps({ state: 'expanded' });
      container = renderSidebar(props);
      const doc = container.querySelector('.gh-lsp-popover__documentation');
      expect(doc).not.toBeNull();
      expect(doc?.textContent).toContain('Greets a person by name.');
    });

    it('renders parameter list', () => {
      const props = createProps({ state: 'expanded' });
      container = renderSidebar(props);
      const params = container.querySelectorAll('.gh-lsp-popover__param');
      expect(params.length).toBe(1);
      const paramName = container.querySelector('.gh-lsp-popover__param-name');
      expect(paramName?.textContent).toBe('name');
    });

    it('renders definition link', () => {
      const props = createProps({ state: 'expanded' });
      container = renderSidebar(props);
      const link = container.querySelector('.gh-lsp-popover__definition-link') as HTMLAnchorElement;
      expect(link).not.toBeNull();
      expect(link.textContent).toBe('Go to Definition');
    });

    it('renders without documentation if not provided', () => {
      const dataWithoutDocs = { ...defaultData, documentation: undefined };
      const props = createProps({ state: 'expanded', data: dataWithoutDocs });
      container = renderSidebar(props);
      const doc = container.querySelector('.gh-lsp-popover__documentation');
      expect(doc).toBeNull();
    });

    it('renders without parameters if not provided', () => {
      const dataNoParams = { ...defaultData, parameters: undefined };
      const props = createProps({ state: 'expanded', data: dataNoParams });
      container = renderSidebar(props);
      const params = container.querySelector('.gh-lsp-popover__parameters');
      expect(params).toBeNull();
    });

    it('renders without definition link if no location', () => {
      const dataNoDefinition = { ...defaultData, definitionLocation: undefined };
      const props = createProps({ state: 'expanded', data: dataNoDefinition });
      container = renderSidebar(props);
      const defSection = container.querySelector('.gh-lsp-popover__definition');
      expect(defSection).toBeNull();
    });
  });

  describe('empty state', () => {
    it('shows empty message when no data and not loading', () => {
      const props = createProps({ state: 'expanded', data: null });
      container = renderSidebar(props);
      const empty = container.querySelector('.gh-lsp-sidebar__empty');
      expect(empty).not.toBeNull();
      expect(empty?.textContent).toBe('Hover over a symbol to see type info');
    });

    it('does not show empty message when loading', () => {
      const props = createProps({ state: 'expanded', data: null, loading: true });
      container = renderSidebar(props);
      const empty = container.querySelector('.gh-lsp-sidebar__empty');
      expect(empty).toBeNull();
    });

    it('does not show empty message when error is present', () => {
      const props = createProps({
        state: 'expanded',
        data: null,
        error: defaultError,
      });
      container = renderSidebar(props);
      const empty = container.querySelector('.gh-lsp-sidebar__empty');
      expect(empty).toBeNull();
    });
  });

  describe('loading state', () => {
    it('shows loading indicator when loading', async () => {
      const props = createProps({ state: 'expanded', data: null, loading: true });
      container = renderSidebar(props);

      // LoadingState has a 200ms delay
      await new Promise((resolve) => setTimeout(resolve, 250));

      const loading = container.querySelector('.gh-lsp-popover__loading');
      expect(loading).not.toBeNull();
    });

    it('does not show data when loading', () => {
      const props = createProps({ state: 'expanded', loading: true });
      container = renderSidebar(props);
      const data = container.querySelector('.gh-lsp-sidebar__data');
      expect(data).toBeNull();
    });
  });

  describe('error state', () => {
    it('renders error when error is present', () => {
      const props = createProps({
        state: 'expanded',
        data: null,
        error: defaultError,
      });
      container = renderSidebar(props);
      const errorEl = container.querySelector('.gh-lsp-popover__error');
      expect(errorEl).not.toBeNull();
    });

    it('renders error message text', () => {
      const props = createProps({
        state: 'expanded',
        data: null,
        error: defaultError,
      });
      container = renderSidebar(props);
      const msg = container.querySelector('.gh-lsp-popover__error-message');
      expect(msg?.textContent).toBe('Language server crashed');
    });

    it('renders retry button for retryable errors', () => {
      const props = createProps({
        state: 'expanded',
        data: null,
        error: defaultError,
      });
      container = renderSidebar(props);
      const retryBtn = container.querySelector('.gh-lsp-popover__retry-btn');
      expect(retryBtn).not.toBeNull();
    });

    it('calls onRetry when retry button clicked', () => {
      const onRetry = vi.fn();
      const props = createProps({
        state: 'expanded',
        data: null,
        error: defaultError,
        onRetry,
      });
      container = renderSidebar(props);
      const retryBtn = container.querySelector('.gh-lsp-popover__retry-btn') as HTMLButtonElement;
      retryBtn.click();
      expect(onRetry).toHaveBeenCalledOnce();
    });
  });

  describe('positioning', () => {
    const positions: SidebarPosition[] = ['right', 'left', 'top', 'bottom'];

    for (const position of positions) {
      it(`renders at ${position} position`, () => {
        const props = createProps({ position, state: 'expanded' });
        container = renderSidebar(props);
        const sidebar = getSidebarElement(container);
        expect(sidebar).not.toBeNull();
        expect(sidebar?.getAttribute('data-position')).toBe(position);
        expect(sidebar?.classList.contains(`gh-lsp-sidebar--${position}`)).toBe(true);
      });
    }

    it('uses position: fixed styling', () => {
      const props = createProps({ position: 'right', state: 'expanded' });
      container = renderSidebar(props);
      const sidebar = getSidebarElement(container);
      expect(sidebar?.style.position).toBe('fixed');
    });

    it('right position sets right: 0', () => {
      const props = createProps({ position: 'right', state: 'expanded' });
      container = renderSidebar(props);
      const sidebar = getSidebarElement(container);
      expect(sidebar?.style.right).toBe('0px');
    });

    it('left position sets left: 0', () => {
      const props = createProps({ position: 'left', state: 'expanded' });
      container = renderSidebar(props);
      const sidebar = getSidebarElement(container);
      expect(sidebar?.style.left).toBe('0px');
    });

    it('top position sets top: 0', () => {
      const props = createProps({ position: 'top', state: 'expanded' });
      container = renderSidebar(props);
      const sidebar = getSidebarElement(container);
      expect(sidebar?.style.top).toBe('0px');
    });

    it('bottom position sets bottom: 0', () => {
      const props = createProps({ position: 'bottom', state: 'expanded' });
      container = renderSidebar(props);
      const sidebar = getSidebarElement(container);
      expect(sidebar?.style.bottom).toBe('0px');
    });

    it('horizontal positions use height: 100vh', () => {
      const props = createProps({ position: 'right', state: 'expanded' });
      container = renderSidebar(props);
      const sidebar = getSidebarElement(container);
      expect(sidebar?.style.height).toBe('100vh');
    });

    it('vertical positions use width: 100vw', () => {
      const props = createProps({ position: 'top', state: 'expanded' });
      container = renderSidebar(props);
      const sidebar = getSidebarElement(container);
      expect(sidebar?.style.width).toBe('100vw');
    });
  });

  describe('toggle interaction', () => {
    it('calls onToggle when toggle button is clicked', () => {
      const onToggle = vi.fn();
      const props = createProps({ state: 'expanded', onToggle });
      container = renderSidebar(props);

      const btn = container.querySelector('.gh-lsp-sidebar__toggle-btn') as HTMLButtonElement;
      btn.click();
      expect(onToggle).toHaveBeenCalledOnce();
    });

    it('calls onToggle when collapsed toggle is clicked', () => {
      const onToggle = vi.fn();
      const props = createProps({ state: 'collapsed', onToggle });
      container = renderSidebar(props);

      const btn = container.querySelector('.gh-lsp-sidebar__toggle-btn') as HTMLButtonElement;
      btn.click();
      expect(onToggle).toHaveBeenCalledOnce();
    });
  });

  describe('escape key', () => {
    it('calls onToggle when Escape pressed and expanded', async () => {
      const onToggle = vi.fn();
      const props = createProps({ state: 'expanded', onToggle });
      container = renderSidebar(props);
      await flushEffects();

      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      document.dispatchEvent(event);
      expect(onToggle).toHaveBeenCalledOnce();
    });

    it('does not call onToggle for other keys', async () => {
      const onToggle = vi.fn();
      const props = createProps({ state: 'expanded', onToggle });
      container = renderSidebar(props);
      await flushEffects();

      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      document.dispatchEvent(event);
      expect(onToggle).not.toHaveBeenCalled();
    });

    it('does not listen for Escape when hidden', async () => {
      const onToggle = vi.fn();
      const props = createProps({ state: 'hidden', onToggle });
      container = renderSidebar(props);
      await flushEffects();

      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      document.dispatchEvent(event);
      expect(onToggle).not.toHaveBeenCalled();
    });
  });

  describe('accessibility', () => {
    it('has role="complementary"', () => {
      const props = createProps({ state: 'expanded' });
      container = renderSidebar(props);
      const sidebar = getSidebarElement(container);
      expect(sidebar?.getAttribute('role')).toBe('complementary');
    });

    it('has aria-label="Code intelligence"', () => {
      const props = createProps({ state: 'expanded' });
      container = renderSidebar(props);
      const sidebar = getSidebarElement(container);
      expect(sidebar?.getAttribute('aria-label')).toBe('Code intelligence');
    });

    it('toggle button has descriptive aria-label', () => {
      const props = createProps({ state: 'expanded' });
      container = renderSidebar(props);
      const btn = container.querySelector('.gh-lsp-sidebar__toggle-btn');
      expect(btn?.getAttribute('aria-label')).toBe('Collapse sidebar');
    });

    it('resize handle has role="separator" for keyboard accessibility', () => {
      const props = createProps({ state: 'expanded' });
      container = renderSidebar(props);
      const handle = container.querySelector('.gh-lsp-sidebar__resize-handle');
      expect(handle?.getAttribute('role')).toBe('separator');
      expect(handle?.getAttribute('tabindex')).toBe('0');
      expect(handle?.getAttribute('aria-label')).toBe('Resize sidebar');
    });

    it('content area has aria-live="polite"', () => {
      const props = createProps({ state: 'expanded' });
      container = renderSidebar(props);
      const content = container.querySelector('.gh-lsp-sidebar__content');
      expect(content?.getAttribute('aria-live')).toBe('polite');
    });

    it('content area has aria-busy when loading', () => {
      const props = createProps({ state: 'expanded', loading: true, data: null });
      container = renderSidebar(props);
      const content = container.querySelector('.gh-lsp-sidebar__content');
      expect(content?.getAttribute('aria-busy')).toBe('true');
    });

    it('content area has aria-busy=false when not loading', () => {
      const props = createProps({ state: 'expanded', loading: false });
      container = renderSidebar(props);
      const content = container.querySelector('.gh-lsp-sidebar__content');
      expect(content?.getAttribute('aria-busy')).toBe('false');
    });
  });

  describe('custom size', () => {
    it('uses custom size prop for width when horizontal', () => {
      const props = createProps({ position: 'right', state: 'expanded', size: 400 });
      container = renderSidebar(props);
      const sidebar = getSidebarElement(container);
      expect(sidebar?.style.width).toBe('400px');
    });

    it('uses custom size prop for height when vertical', () => {
      const props = createProps({ position: 'bottom', state: 'expanded', size: 350 });
      container = renderSidebar(props);
      const sidebar = getSidebarElement(container);
      expect(sidebar?.style.height).toBe('350px');
    });

    it('uses collapsed size (36px) when collapsed regardless of size prop', () => {
      const props = createProps({ position: 'right', state: 'collapsed', size: 400 });
      container = renderSidebar(props);
      const sidebar = getSidebarElement(container);
      expect(sidebar?.style.width).toBe('36px');
    });
  });

  describe('toggle arrow direction', () => {
    it('shows left arrow when right sidebar is expanded', () => {
      container = renderSidebar(createProps({ position: 'right', state: 'collapsed' }));
      const btn = container.querySelector('.gh-lsp-sidebar__toggle-btn');
      // Collapsed right sidebar shows left arrow (to expand/open leftward)
      expect(btn?.textContent).toBe('\u25C0');
    });

    it('shows right arrow when right sidebar is expanded', () => {
      container = renderSidebar(createProps({ position: 'right', state: 'expanded' }));
      const btn = container.querySelector('.gh-lsp-sidebar__toggle-btn');
      // Expanded right sidebar shows right arrow (to collapse/close rightward)
      expect(btn?.textContent).toBe('\u25B6');
    });

    it('shows correct arrows for left position', () => {
      container = renderSidebar(createProps({ position: 'left', state: 'collapsed' }));
      let btn = container.querySelector('.gh-lsp-sidebar__toggle-btn');
      expect(btn?.textContent).toBe('\u25B6'); // right arrow to expand

      render(null, container);
      container.parentNode?.removeChild(container);

      container = renderSidebar(createProps({ position: 'left', state: 'expanded' }));
      btn = container.querySelector('.gh-lsp-sidebar__toggle-btn');
      expect(btn?.textContent).toBe('\u25C0'); // left arrow to collapse
    });

    it('shows correct arrows for top position', () => {
      container = renderSidebar(createProps({ position: 'top', state: 'collapsed' }));
      let btn = container.querySelector('.gh-lsp-sidebar__toggle-btn');
      expect(btn?.textContent).toBe('\u25BC'); // down arrow to expand

      render(null, container);
      container.parentNode?.removeChild(container);

      container = renderSidebar(createProps({ position: 'top', state: 'expanded' }));
      btn = container.querySelector('.gh-lsp-sidebar__toggle-btn');
      expect(btn?.textContent).toBe('\u25B2'); // up arrow to collapse
    });

    it('shows correct arrows for bottom position', () => {
      container = renderSidebar(createProps({ position: 'bottom', state: 'collapsed' }));
      let btn = container.querySelector('.gh-lsp-sidebar__toggle-btn');
      expect(btn?.textContent).toBe('\u25B2'); // up arrow to expand

      render(null, container);
      container.parentNode?.removeChild(container);

      container = renderSidebar(createProps({ position: 'bottom', state: 'expanded' }));
      btn = container.querySelector('.gh-lsp-sidebar__toggle-btn');
      expect(btn?.textContent).toBe('\u25BC'); // down arrow to collapse
    });
  });

  describe('resize handle', () => {
    it('has resize handle for right position', () => {
      container = renderSidebar(createProps({ position: 'right', state: 'expanded' }));
      const handle = container.querySelector('.gh-lsp-sidebar__resize-handle') as HTMLElement;
      expect(handle).not.toBeNull();
      expect(handle.style.cursor).toBe('col-resize');
      expect(handle.style.left).toBe('0px');
    });

    it('has resize handle for left position', () => {
      container = renderSidebar(createProps({ position: 'left', state: 'expanded' }));
      const handle = container.querySelector('.gh-lsp-sidebar__resize-handle') as HTMLElement;
      expect(handle).not.toBeNull();
      expect(handle.style.cursor).toBe('col-resize');
      expect(handle.style.right).toBe('0px');
    });

    it('has resize handle for top position', () => {
      container = renderSidebar(createProps({ position: 'top', state: 'expanded' }));
      const handle = container.querySelector('.gh-lsp-sidebar__resize-handle') as HTMLElement;
      expect(handle).not.toBeNull();
      expect(handle.style.cursor).toBe('row-resize');
      expect(handle.style.bottom).toBe('0px');
    });

    it('has resize handle for bottom position', () => {
      container = renderSidebar(createProps({ position: 'bottom', state: 'expanded' }));
      const handle = container.querySelector('.gh-lsp-sidebar__resize-handle') as HTMLElement;
      expect(handle).not.toBeNull();
      expect(handle.style.cursor).toBe('row-resize');
      expect(handle.style.top).toBe('0px');
    });
  });

  describe('data-* attributes', () => {
    it('sets data-state attribute', () => {
      container = renderSidebar(createProps({ state: 'expanded' }));
      const sidebar = getSidebarElement(container);
      expect(sidebar?.getAttribute('data-state')).toBe('expanded');
    });

    it('sets data-position attribute', () => {
      container = renderSidebar(createProps({ position: 'left' }));
      const sidebar = getSidebarElement(container);
      expect(sidebar?.getAttribute('data-position')).toBe('left');
    });
  });

  describe('resize handle accessibility', () => {
    it('has role="separator" when expanded', () => {
      container = renderSidebar(createProps({ state: 'expanded', position: 'right' }));
      const handle = container.querySelector('.gh-lsp-sidebar__resize-handle');
      expect(handle?.getAttribute('role')).toBe('separator');
    });

    it('has tabindex="0" for keyboard focusability', () => {
      container = renderSidebar(createProps({ state: 'expanded', position: 'right' }));
      const handle = container.querySelector('.gh-lsp-sidebar__resize-handle');
      expect(handle?.getAttribute('tabindex')).toBe('0');
    });

    it('has aria-orientation="vertical" for horizontal positions', () => {
      container = renderSidebar(createProps({ state: 'expanded', position: 'right' }));
      const handle = container.querySelector('.gh-lsp-sidebar__resize-handle');
      expect(handle?.getAttribute('aria-orientation')).toBe('vertical');
    });

    it('has aria-orientation="horizontal" for vertical positions', () => {
      container = renderSidebar(createProps({ state: 'expanded', position: 'bottom' }));
      const handle = container.querySelector('.gh-lsp-sidebar__resize-handle');
      expect(handle?.getAttribute('aria-orientation')).toBe('horizontal');
    });

    it('has aria-valuenow reflecting current size', () => {
      container = renderSidebar(createProps({ state: 'expanded', size: 350 }));
      const handle = container.querySelector('.gh-lsp-sidebar__resize-handle');
      expect(handle?.getAttribute('aria-valuenow')).toBe('350');
    });

    it('has aria-valuemin reflecting minimum size', () => {
      container = renderSidebar(createProps({ state: 'expanded' }));
      const handle = container.querySelector('.gh-lsp-sidebar__resize-handle');
      expect(handle?.getAttribute('aria-valuemin')).toBe('200');
    });

    it('has aria-label for screen readers', () => {
      container = renderSidebar(createProps({ state: 'expanded' }));
      const handle = container.querySelector('.gh-lsp-sidebar__resize-handle');
      expect(handle?.getAttribute('aria-label')).toBe('Resize sidebar');
    });

    it('increases size with ArrowLeft on right-positioned sidebar', async () => {
      const onSizeChange = vi.fn();
      container = renderSidebar(createProps({
        state: 'expanded',
        position: 'right',
        size: 300,
        onSizeChange,
      }));
      await flushEffects();

      const handle = container.querySelector('.gh-lsp-sidebar__resize-handle') as HTMLElement;
      const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true });
      handle.dispatchEvent(event);

      expect(onSizeChange).toHaveBeenCalledWith(320);
    });

    it('decreases size with ArrowRight on right-positioned sidebar', async () => {
      const onSizeChange = vi.fn();
      container = renderSidebar(createProps({
        state: 'expanded',
        position: 'right',
        size: 300,
        onSizeChange,
      }));
      await flushEffects();

      const handle = container.querySelector('.gh-lsp-sidebar__resize-handle') as HTMLElement;
      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
      handle.dispatchEvent(event);

      expect(onSizeChange).toHaveBeenCalledWith(280);
    });

    it('does not resize below minimum size', async () => {
      const onSizeChange = vi.fn();
      container = renderSidebar(createProps({
        state: 'expanded',
        position: 'right',
        size: 200,
        onSizeChange,
      }));
      await flushEffects();

      const handle = container.querySelector('.gh-lsp-sidebar__resize-handle') as HTMLElement;
      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
      handle.dispatchEvent(event);

      // Should clamp to 200 (min)
      expect(onSizeChange).toHaveBeenCalledWith(200);
    });

    it('resizes vertically with ArrowUp on bottom-positioned sidebar', async () => {
      const onSizeChange = vi.fn();
      container = renderSidebar(createProps({
        state: 'expanded',
        position: 'bottom',
        size: 300,
        onSizeChange,
      }));
      await flushEffects();

      const handle = container.querySelector('.gh-lsp-sidebar__resize-handle') as HTMLElement;
      const event = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true });
      handle.dispatchEvent(event);

      expect(onSizeChange).toHaveBeenCalledWith(320);
    });
  });
});
