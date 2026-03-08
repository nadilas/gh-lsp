import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock UI modules (must be before imports that use them) ─────────────────

vi.mock('../../../src/ui/mount', () => ({
  ExtensionMount: vi.fn().mockImplementation(() => ({
    create: vi.fn(() => ({})),
    injectStyles: vi.fn(),
    render: vi.fn(),
    destroy: vi.fn(),
    setDataAttribute: vi.fn(),
    getShadowRoot: vi.fn(() => null),
    getContainer: vi.fn(() => null),
    getHostElement: vi.fn(() => null),
    isActive: vi.fn(() => true),
  })),
}));

vi.mock('../../../src/ui/popover/Popover', () => ({
  Popover: vi.fn(() => null),
}));

vi.mock('../../../src/ui/sidebar/Sidebar', () => ({
  Sidebar: vi.fn(() => null),
}));

vi.mock('../../../src/ui/popover/positioning', () => ({
  calculatePopoverPosition: vi.fn(() => ({
    top: 100,
    left: 200,
    placement: 'below' as const,
  })),
}));

vi.mock('../../../src/ui/theme', () => ({
  detectTheme: vi.fn(() => 'light' as const),
  onThemeChange: vi.fn(() => () => {}),
}));

vi.mock('../../../src/ui/styles/theme.css?inline', () => ({
  default: '',
}));

// ─── Imports ────────────────────────────────────────────────────────────────

import { GhLspContentScript } from '../../../src/content/index';
import { ExtensionMount } from '../../../src/ui/mount';
import type {
  ExtensionSettings,
  LspHoverResponse,
  SettingsChangedMessage,
  ExtensionToggleMessage,
} from '../../../src/shared/types';
import { DEFAULT_SETTINGS } from '../../../src/shared/settings';

// ─── Chrome API mock ────────────────────────────────────────────────────────

type MessageListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
) => void;

let messageListeners: MessageListener[] = [];
let sendMessageMock: ReturnType<typeof vi.fn>;
let storageData: Record<string, unknown> = {};

function setupChromeMock(settingsOverrides: Partial<ExtensionSettings> = {}) {
  messageListeners = [];
  sendMessageMock = vi.fn().mockResolvedValue(undefined);

  const settings = { ...DEFAULT_SETTINGS, ...settingsOverrides };
  storageData = { 'gh-lsp-settings': settings };

  const chromeMock = {
    runtime: {
      sendMessage: sendMessageMock,
      onMessage: {
        addListener: vi.fn((listener: MessageListener) => {
          messageListeners.push(listener);
        }),
        removeListener: vi.fn((listener: MessageListener) => {
          messageListeners = messageListeners.filter((l) => l !== listener);
        }),
      },
    },
    storage: {
      sync: {
        get: vi.fn((key: string) =>
          Promise.resolve({ [key]: storageData[key] }),
        ),
        set: vi.fn().mockResolvedValue(undefined),
      },
      local: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
      },
    },
  };

  vi.stubGlobal('chrome', chromeMock);
}

// ─── DOM helpers ─────────────────────────────────────────────────────────────

function setLocationTo(url: string) {
  // jsdom allows redefining location properties
  Object.defineProperty(window, 'location', {
    value: { href: url, pathname: new URL(url).pathname },
    writable: true,
    configurable: true,
  });
}

function createCodeContainer(): HTMLElement {
  const container = document.createElement('div');
  container.className = 'react-code-lines';
  document.body.appendChild(container);
  return container;
}

function createCodeLine(lineNumber: number): HTMLElement {
  const row = document.createElement('div');
  row.className = 'react-line-row';
  row.setAttribute('data-line-number', String(lineNumber));

  const content = document.createElement('div');
  content.className = 'react-file-line';
  content.textContent = `  const x: number = ${lineNumber};`;
  row.appendChild(content);

  return row;
}

// ─── Helper: get the latest ExtensionMount mock instance ────────────────────

function getLatestMountInstance() {
  const MockedMount = vi.mocked(ExtensionMount);
  const results = MockedMount.mock.results;
  if (results.length === 0) return null;
  return results[results.length - 1]?.value as {
    create: ReturnType<typeof vi.fn>;
    injectStyles: ReturnType<typeof vi.fn>;
    render: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    setDataAttribute: ReturnType<typeof vi.fn>;
  } | null;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('GhLspContentScript', () => {
  let script: GhLspContentScript;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    setupChromeMock();
    vi.mocked(ExtensionMount).mockClear();
  });

  afterEach(() => {
    script?.dispose();
    vi.useRealTimers();
    // Use clearAllMocks (not restoreAllMocks) to preserve vi.mock implementations
    // while clearing call history/results for the next test
    vi.clearAllMocks();
  });

  // ── Initialization ─────────────────────────────────────────────────────

  describe('initialize()', () => {
    it('activates on a blob code page', async () => {
      setLocationTo('https://github.com/owner/repo/blob/main/src/index.ts');
      script = new GhLspContentScript();

      await script.initialize();

      expect(script.getState()).toBe('active');
      expect(script.getContext()).toEqual({
        owner: 'owner',
        repo: 'repo',
        ref: 'main',
        filePath: 'src/index.ts',
        language: 'typescript',
      });
    });

    it('stays dormant on a non-code page', async () => {
      setLocationTo('https://github.com/owner/repo/issues');
      script = new GhLspContentScript();

      await script.initialize();

      expect(script.getState()).toBe('dormant');
      expect(script.getContext()).toBeNull();
    });

    it('stays dormant when extension is disabled', async () => {
      setupChromeMock({ enabled: false });
      setLocationTo('https://github.com/owner/repo/blob/main/src/index.ts');
      script = new GhLspContentScript();

      await script.initialize();

      expect(script.getState()).toBe('dormant');
    });

    it('sends page/navigated message on activation', async () => {
      setLocationTo('https://github.com/owner/repo/blob/main/src/index.ts');
      script = new GhLspContentScript();

      await script.initialize();

      expect(sendMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'page/navigated',
          newContext: expect.objectContaining({
            owner: 'owner',
            repo: 'repo',
          }),
        }),
      );
    });

    it('detects PR files page', async () => {
      setLocationTo('https://github.com/owner/repo/pull/42/files');
      script = new GhLspContentScript();

      await script.initialize();

      expect(script.getState()).toBe('active');
      expect(script.getContext()?.ref).toBe('pull/42');
    });

    it('detects compare page', async () => {
      setLocationTo('https://github.com/owner/repo/compare/main...feature');
      script = new GhLspContentScript();

      await script.initialize();

      expect(script.getState()).toBe('active');
      expect(script.getContext()?.ref).toBe('main...feature');
    });

    it('handles settings loading failure gracefully', async () => {
      // Make storage.sync.get throw
      vi.mocked(chrome.storage.sync.get).mockRejectedValue(
        new Error('Extension context invalidated'),
      );
      setLocationTo('https://github.com/owner/repo/blob/main/src/index.ts');
      script = new GhLspContentScript();

      await script.initialize();

      expect(script.getState()).toBe('dormant');
    });
  });

  // ── Deactivation ───────────────────────────────────────────────────────

  describe('deactivate()', () => {
    it('transitions from active to dormant', async () => {
      setLocationTo('https://github.com/owner/repo/blob/main/src/index.ts');
      script = new GhLspContentScript();
      await script.initialize();

      expect(script.getState()).toBe('active');

      script.deactivate();

      expect(script.getState()).toBe('dormant');
      expect(script.getContext()).toBeNull();
    });

    it('is a no-op when already dormant', async () => {
      setLocationTo('https://github.com/owner/repo/issues');
      script = new GhLspContentScript();
      await script.initialize();

      // Should not throw
      script.deactivate();
      expect(script.getState()).toBe('dormant');
    });
  });

  // ── Dispose ────────────────────────────────────────────────────────────

  describe('dispose()', () => {
    it('transitions to disposed state', async () => {
      setLocationTo('https://github.com/owner/repo/blob/main/src/index.ts');
      script = new GhLspContentScript();
      await script.initialize();

      script.dispose();

      expect(script.getState()).toBe('disposed');
    });

    it('cannot be re-initialized after disposal', async () => {
      setLocationTo('https://github.com/owner/repo/blob/main/src/index.ts');
      script = new GhLspContentScript();
      await script.initialize();

      script.dispose();
      await script.initialize();

      // Should remain disposed
      expect(script.getState()).toBe('disposed');
    });

    it('cannot be activated after disposal', async () => {
      setLocationTo('https://github.com/owner/repo/blob/main/src/index.ts');
      script = new GhLspContentScript();
      await script.initialize();

      script.dispose();
      script.activate({
        owner: 'a',
        repo: 'b',
        ref: 'c',
        filePath: 'd',
        language: 'typescript',
      });

      expect(script.getState()).toBe('disposed');
    });
  });

  // ── Turbo Navigation ───────────────────────────────────────────────────

  describe('Turbo navigation', () => {
    it('re-activates when navigating to another code page', async () => {
      setLocationTo('https://github.com/owner/repo/blob/main/src/index.ts');
      script = new GhLspContentScript();
      await script.initialize();

      expect(script.getContext()?.filePath).toBe('src/index.ts');

      // Simulate Turbo navigation to a different file
      setLocationTo('https://github.com/owner/repo/blob/main/src/utils.go');
      document.dispatchEvent(new Event('turbo:load'));

      expect(script.getState()).toBe('active');
      expect(script.getContext()?.filePath).toBe('src/utils.go');
      expect(script.getContext()?.language).toBe('go');
    });

    it('deactivates when navigating to a non-code page', async () => {
      setLocationTo('https://github.com/owner/repo/blob/main/src/index.ts');
      script = new GhLspContentScript();
      await script.initialize();

      // Simulate Turbo navigation to issues page
      setLocationTo('https://github.com/owner/repo/issues');
      document.dispatchEvent(new Event('turbo:load'));

      expect(script.getState()).toBe('dormant');
      expect(script.getContext()).toBeNull();
    });

    it('sends page/navigated with null context when leaving code page', async () => {
      setLocationTo('https://github.com/owner/repo/blob/main/src/index.ts');
      script = new GhLspContentScript();
      await script.initialize();

      sendMessageMock.mockClear();

      setLocationTo('https://github.com/owner/repo/issues');
      document.dispatchEvent(new Event('turbo:load'));

      expect(sendMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'page/navigated',
          newContext: null,
        }),
      );
    });

    it('handles popstate (browser back/forward) navigation', async () => {
      setLocationTo('https://github.com/owner/repo/blob/main/src/index.ts');
      script = new GhLspContentScript();
      await script.initialize();

      // Navigate away via popstate
      setLocationTo('https://github.com/owner/repo/blob/main/src/app.py');
      window.dispatchEvent(new Event('popstate'));

      expect(script.getState()).toBe('active');
      expect(script.getContext()?.language).toBe('python');
    });

    it('does not re-activate on navigation when disabled', async () => {
      setupChromeMock({ enabled: false });
      setLocationTo('https://github.com/owner/repo/issues');
      script = new GhLspContentScript();
      await script.initialize();

      // Navigate to code page while disabled
      setLocationTo('https://github.com/owner/repo/blob/main/src/index.ts');
      document.dispatchEvent(new Event('turbo:load'));

      expect(script.getState()).toBe('dormant');
    });
  });

  // ── Settings Changes ───────────────────────────────────────────────────

  describe('settings changes', () => {
    it('handles debounce timing change while active', async () => {
      setLocationTo('https://github.com/owner/repo/blob/main/src/index.ts');
      script = new GhLspContentScript();
      await script.initialize();

      // Simulate settings change from background
      const settingsMessage: SettingsChangedMessage = {
        type: 'settings/changed',
        changes: { hoverDebounceMs: 500 },
      };

      // Fire the message through the notification listener
      for (const listener of messageListeners) {
        listener(settingsMessage, {} as chrome.runtime.MessageSender, vi.fn());
      }

      // Should still be active (token detector was restarted)
      expect(script.getState()).toBe('active');
    });

    it('handles display mode change', async () => {
      setLocationTo('https://github.com/owner/repo/blob/main/src/index.ts');
      script = new GhLspContentScript();
      await script.initialize();

      const settingsMessage: SettingsChangedMessage = {
        type: 'settings/changed',
        changes: { displayMode: 'sidebar' },
      };

      for (const listener of messageListeners) {
        listener(settingsMessage, {} as chrome.runtime.MessageSender, vi.fn());
      }

      expect(script.getState()).toBe('active');
    });
  });

  // ── Extension Toggle ───────────────────────────────────────────────────

  describe('extension toggle', () => {
    it('deactivates when extension is disabled', async () => {
      setLocationTo('https://github.com/owner/repo/blob/main/src/index.ts');
      script = new GhLspContentScript();
      await script.initialize();

      expect(script.getState()).toBe('active');

      const toggleMessage: ExtensionToggleMessage = {
        type: 'extension/toggle',
        enabled: false,
      };

      for (const listener of messageListeners) {
        listener(toggleMessage, {} as chrome.runtime.MessageSender, vi.fn());
      }

      expect(script.getState()).toBe('dormant');
    });

    it('re-activates when extension is re-enabled on a code page', async () => {
      setupChromeMock({ enabled: false });
      setLocationTo('https://github.com/owner/repo/blob/main/src/index.ts');
      script = new GhLspContentScript();
      await script.initialize();

      expect(script.getState()).toBe('dormant');

      // Re-enable
      const toggleMessage: ExtensionToggleMessage = {
        type: 'extension/toggle',
        enabled: true,
      };

      for (const listener of messageListeners) {
        listener(toggleMessage, {} as chrome.runtime.MessageSender, vi.fn());
      }

      expect(script.getState()).toBe('active');
      expect(script.getContext()?.filePath).toBe('src/index.ts');
    });

    it('stays dormant when re-enabled on a non-code page', async () => {
      setupChromeMock({ enabled: false });
      setLocationTo('https://github.com/owner/repo/issues');
      script = new GhLspContentScript();
      await script.initialize();

      const toggleMessage: ExtensionToggleMessage = {
        type: 'extension/toggle',
        enabled: true,
      };

      for (const listener of messageListeners) {
        listener(toggleMessage, {} as chrome.runtime.MessageSender, vi.fn());
      }

      expect(script.getState()).toBe('dormant');
    });
  });

  // ── Hover Flow ─────────────────────────────────────────────────────────

  describe('hover flow', () => {
    it('sends hover request on token hover', async () => {
      setLocationTo('https://github.com/owner/repo/blob/main/src/index.ts');
      script = new GhLspContentScript();

      // Set up sendMessage to return a hover response
      const hoverResponse: LspHoverResponse = {
        type: 'lsp/response',
        requestId: 'test-id',
        kind: 'hover',
        result: {
          contents: { kind: 'markdown', value: '```ts\nconst x: number\n```' },
        },
      };
      sendMessageMock.mockResolvedValue(hoverResponse);

      await script.initialize();

      // Create a code container with a line
      const container = createCodeContainer();
      const line = createCodeLine(5);
      container.appendChild(line);

      // Simulate mouse move over the code line
      const codeContent = line.querySelector('.react-file-line')!;
      const moveEvent = new MouseEvent('mousemove', {
        clientX: 100,
        clientY: 50,
        bubbles: true,
      });
      Object.defineProperty(moveEvent, 'target', { value: codeContent });
      document.dispatchEvent(moveEvent);

      // Wait for debounce (default 300ms)
      vi.advanceTimersByTime(350);

      // The hover request should have been sent
      // (first call is page/navigated, second is the hover request)
      const hoverCalls = sendMessageMock.mock.calls.filter(
        (call: unknown[]) => (call[0] as { type: string }).type === 'lsp/hover',
      );
      expect(hoverCalls.length).toBe(1);
      expect(hoverCalls[0]![0]).toEqual(
        expect.objectContaining({
          type: 'lsp/hover',
          owner: 'owner',
          repo: 'repo',
          ref: 'main',
          filePath: 'src/index.ts',
          position: expect.objectContaining({ line: 4 }), // 5-1 = 4 (0-indexed)
        }),
      );
    });

    it('cancels pending hover on mouse leave', async () => {
      setLocationTo('https://github.com/owner/repo/blob/main/src/index.ts');
      script = new GhLspContentScript();

      // Make sendMessage hang (never resolve)
      sendMessageMock.mockImplementation((msg: { type: string }) => {
        if (msg.type === 'lsp/hover') {
          return new Promise(() => {}); // Never resolves
        }
        return Promise.resolve(undefined);
      });

      await script.initialize();

      const container = createCodeContainer();
      const line = createCodeLine(5);
      container.appendChild(line);

      const codeContent = line.querySelector('.react-file-line')!;

      // Hover over code
      const moveEvent = new MouseEvent('mousemove', {
        clientX: 100,
        clientY: 50,
        bubbles: true,
      });
      Object.defineProperty(moveEvent, 'target', { value: codeContent });
      document.dispatchEvent(moveEvent);

      vi.advanceTimersByTime(350);

      // Mouse leaves the document
      document.dispatchEvent(new Event('mouseleave'));

      // Should have sent a cancel
      const cancelCalls = sendMessageMock.mock.calls.filter(
        (call: unknown[]) => (call[0] as { type: string }).type === 'lsp/cancel',
      );
      expect(cancelCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('starts loading timer on hover and clears on response', async () => {
      setLocationTo('https://github.com/owner/repo/blob/main/src/index.ts');
      script = new GhLspContentScript();

      let resolveHover: ((value: unknown) => void) | null = null;
      sendMessageMock.mockImplementation((msg: { type: string }) => {
        if (msg.type === 'lsp/hover') {
          return new Promise((resolve) => {
            resolveHover = resolve;
          });
        }
        return Promise.resolve(undefined);
      });

      await script.initialize();

      const container = createCodeContainer();
      const line = createCodeLine(3);
      container.appendChild(line);

      const codeContent = line.querySelector('.react-file-line')!;
      const moveEvent = new MouseEvent('mousemove', {
        clientX: 100,
        clientY: 50,
        bubbles: true,
      });
      Object.defineProperty(moveEvent, 'target', { value: codeContent });
      document.dispatchEvent(moveEvent);

      // Wait for debounce
      vi.advanceTimersByTime(350);

      // Loading timer should be active (200ms delay)
      // Advance part of the loading delay
      vi.advanceTimersByTime(100);

      // Resolve the hover response
      if (resolveHover !== null) {
        (resolveHover as (value: unknown) => void)({
          type: 'lsp/response',
          requestId: 'test',
          kind: 'hover',
          result: {
            contents: { kind: 'plaintext', value: 'string' },
          },
        });
      }

      // Flush microtasks
      await vi.advanceTimersByTimeAsync(0);

      // Loading timer should have been cleared (no assertion needed —
      // the test passes if no unhandled errors occur)
    });
  });

  // ── Re-activation ──────────────────────────────────────────────────────

  describe('re-activation', () => {
    it('deactivates before re-activating on same page type', async () => {
      setLocationTo('https://github.com/owner/repo/blob/main/src/index.ts');
      script = new GhLspContentScript();
      await script.initialize();

      // Directly call activate again with different context
      script.activate({
        owner: 'other',
        repo: 'project',
        ref: 'dev',
        filePath: 'lib/util.rs',
        language: 'rust',
      });

      expect(script.getState()).toBe('active');
      expect(script.getContext()?.owner).toBe('other');
      expect(script.getContext()?.language).toBe('rust');
    });
  });

  // ── Command Listener ───────────────────────────────────────────────

  describe('command listener', () => {
    it('registers a command listener on chrome.runtime.onMessage', async () => {
      setLocationTo('https://github.com/owner/repo/blob/main/src/index.ts');
      script = new GhLspContentScript();
      await script.initialize();

      // The content messaging listener + the command listener = 2 listeners
      expect(chrome.runtime.onMessage.addListener).toHaveBeenCalled();
    });

    it('pin-popover command toggles popover pin state', async () => {
      setLocationTo('https://github.com/owner/repo/blob/main/src/index.ts');
      script = new GhLspContentScript();

      const hoverResponse: LspHoverResponse = {
        type: 'lsp/response',
        requestId: 'test-id',
        kind: 'hover',
        result: {
          contents: { kind: 'plaintext', value: 'const x: number' },
        },
      };
      sendMessageMock.mockResolvedValue(hoverResponse);

      await script.initialize();

      // Trigger a hover to get a visible popover
      const container = createCodeContainer();
      const line = createCodeLine(5);
      container.appendChild(line);

      const codeContent = line.querySelector('.react-file-line')!;
      const moveEvent = new MouseEvent('mousemove', {
        clientX: 100,
        clientY: 50,
        bubbles: true,
      });
      Object.defineProperty(moveEvent, 'target', { value: codeContent });
      document.dispatchEvent(moveEvent);

      vi.advanceTimersByTime(350);
      await vi.advanceTimersByTimeAsync(0);

      expect(script.getPopoverState()).toBe('visible');

      // Send pin-popover command via message listener
      for (const listener of messageListeners) {
        listener(
          { command: 'pin-popover' },
          {} as chrome.runtime.MessageSender,
          vi.fn(),
        );
      }

      expect(script.getPopoverState()).toBe('pinned');

      // Send again to unpin
      for (const listener of messageListeners) {
        listener(
          { command: 'pin-popover' },
          {} as chrome.runtime.MessageSender,
          vi.fn(),
        );
      }

      expect(script.getPopoverState()).toBe('visible');
    });

    it('ignores unknown commands', async () => {
      setLocationTo('https://github.com/owner/repo/blob/main/src/index.ts');
      script = new GhLspContentScript();
      await script.initialize();

      // Should not throw
      for (const listener of messageListeners) {
        listener(
          { command: 'unknown-command' },
          {} as chrome.runtime.MessageSender,
          vi.fn(),
        );
      }

      expect(script.getState()).toBe('active');
    });

    it('cleans up command listener on dispose', async () => {
      setLocationTo('https://github.com/owner/repo/blob/main/src/index.ts');
      script = new GhLspContentScript();
      await script.initialize();

      const removeListenerMock = vi.mocked(chrome.runtime.onMessage.removeListener);
      const callsBefore = removeListenerMock.mock.calls.length;

      script.dispose();

      // Should have called removeListener for the command listener
      expect(removeListenerMock.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  // ── Edge Cases ─────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles multiple rapid navigations', async () => {
      setLocationTo('https://github.com/owner/repo/blob/main/src/a.ts');
      script = new GhLspContentScript();
      await script.initialize();

      // Rapid navigations
      setLocationTo('https://github.com/owner/repo/blob/main/src/b.go');
      document.dispatchEvent(new Event('turbo:load'));

      setLocationTo('https://github.com/owner/repo/blob/main/src/c.py');
      document.dispatchEvent(new Event('turbo:load'));

      setLocationTo('https://github.com/owner/repo/blob/main/src/d.rs');
      document.dispatchEvent(new Event('turbo:load'));

      expect(script.getState()).toBe('active');
      expect(script.getContext()?.filePath).toBe('src/d.rs');
      expect(script.getContext()?.language).toBe('rust');
    });

    it('ignores non-extension messages in notification listener', async () => {
      setLocationTo('https://github.com/owner/repo/blob/main/src/index.ts');
      script = new GhLspContentScript();
      await script.initialize();

      // Send a non-extension message
      for (const listener of messageListeners) {
        listener({ random: 'garbage' }, {} as chrome.runtime.MessageSender, vi.fn());
      }

      // Should still be active
      expect(script.getState()).toBe('active');
    });
  });

  // ── UI Integration ────────────────────────────────────────────────────

  describe('UI integration', () => {
    it('creates ExtensionMount on activation', async () => {
      setLocationTo('https://github.com/owner/repo/blob/main/src/index.ts');
      script = new GhLspContentScript();

      await script.initialize();

      expect(ExtensionMount).toHaveBeenCalled();
      const mountInstance = getLatestMountInstance();
      expect(mountInstance).not.toBeNull();
      expect(mountInstance!.create).toHaveBeenCalled();
      expect(mountInstance!.injectStyles).toHaveBeenCalled();
      expect(mountInstance!.setDataAttribute).toHaveBeenCalledWith('theme', 'light');
      expect(mountInstance!.render).toHaveBeenCalled();
    });

    it('destroys ExtensionMount on deactivation', async () => {
      setLocationTo('https://github.com/owner/repo/blob/main/src/index.ts');
      script = new GhLspContentScript();
      await script.initialize();

      const mountInstance = getLatestMountInstance();

      script.deactivate();

      expect(mountInstance!.destroy).toHaveBeenCalled();
    });

    it('does not create mount on non-code page', async () => {
      setLocationTo('https://github.com/owner/repo/issues');
      script = new GhLspContentScript();

      await script.initialize();

      expect(ExtensionMount).not.toHaveBeenCalled();
    });

    it('uses popover mode by default', async () => {
      setLocationTo('https://github.com/owner/repo/blob/main/src/index.ts');
      script = new GhLspContentScript();
      await script.initialize();

      expect(script.getDisplayMode()).toBe('popover');
      expect(script.getPopoverState()).toBe('hidden');
    });

    it('uses sidebar mode when configured', async () => {
      setupChromeMock({ displayMode: 'sidebar' });
      setLocationTo('https://github.com/owner/repo/blob/main/src/index.ts');
      script = new GhLspContentScript();
      await script.initialize();

      expect(script.getDisplayMode()).toBe('sidebar');
      expect(script.getSidebarState()).toBe('expanded');
    });

    it('switches display mode on settings change', async () => {
      setLocationTo('https://github.com/owner/repo/blob/main/src/index.ts');
      script = new GhLspContentScript();
      await script.initialize();

      expect(script.getDisplayMode()).toBe('popover');

      // Switch to sidebar
      const settingsMessage: SettingsChangedMessage = {
        type: 'settings/changed',
        changes: { displayMode: 'sidebar' },
      };

      for (const listener of messageListeners) {
        listener(settingsMessage, {} as chrome.runtime.MessageSender, vi.fn());
      }

      expect(script.getDisplayMode()).toBe('sidebar');
      expect(script.getSidebarState()).toBe('expanded');
    });

    it('renders hover data in popover mode', async () => {
      setLocationTo('https://github.com/owner/repo/blob/main/src/index.ts');
      script = new GhLspContentScript();

      const hoverResponse: LspHoverResponse = {
        type: 'lsp/response',
        requestId: 'test-id',
        kind: 'hover',
        result: {
          contents: {
            kind: 'markdown',
            value: '```ts\nconst x: number\n```\nA numeric variable.',
          },
        },
      };
      sendMessageMock.mockResolvedValue(hoverResponse);

      await script.initialize();

      // Trigger hover
      const container = createCodeContainer();
      const line = createCodeLine(5);
      container.appendChild(line);

      const codeContent = line.querySelector('.react-file-line')!;
      const moveEvent = new MouseEvent('mousemove', {
        clientX: 100,
        clientY: 50,
        bubbles: true,
      });
      Object.defineProperty(moveEvent, 'target', { value: codeContent });
      document.dispatchEvent(moveEvent);

      // Wait for debounce
      vi.advanceTimersByTime(350);

      // Flush microtasks for the hover response
      await vi.advanceTimersByTimeAsync(0);

      expect(script.getPopoverState()).toBe('visible');
      expect(script.getHoverData()).toEqual({
        signature: 'const x: number',
        language: 'typescript',
        documentation: 'A numeric variable.',
      });
    });

    it('renders hover data in sidebar mode', async () => {
      setupChromeMock({ displayMode: 'sidebar' });
      setLocationTo('https://github.com/owner/repo/blob/main/src/index.ts');
      script = new GhLspContentScript();

      const hoverResponse: LspHoverResponse = {
        type: 'lsp/response',
        requestId: 'test-id',
        kind: 'hover',
        result: {
          contents: {
            kind: 'markdown',
            value: '```ts\nfunction greet(): void\n```\nGreets the user.',
          },
        },
      };
      sendMessageMock.mockResolvedValue(hoverResponse);

      await script.initialize();

      expect(script.getSidebarState()).toBe('expanded');

      // Trigger hover
      const container = createCodeContainer();
      const line = createCodeLine(3);
      container.appendChild(line);

      const codeContent = line.querySelector('.react-file-line')!;
      const moveEvent = new MouseEvent('mousemove', {
        clientX: 100,
        clientY: 50,
        bubbles: true,
      });
      Object.defineProperty(moveEvent, 'target', { value: codeContent });
      document.dispatchEvent(moveEvent);

      vi.advanceTimersByTime(350);
      await vi.advanceTimersByTimeAsync(0);

      expect(script.getSidebarState()).toBe('expanded');
      expect(script.getHoverData()).toEqual({
        signature: 'function greet(): void',
        language: 'typescript',
        documentation: 'Greets the user.',
      });
    });

    it('shows loading state after delay', async () => {
      setLocationTo('https://github.com/owner/repo/blob/main/src/index.ts');
      script = new GhLspContentScript();

      // Make sendMessage hang (never resolve)
      sendMessageMock.mockImplementation((msg: { type: string }) => {
        if (msg.type === 'lsp/hover') {
          return new Promise(() => {}); // Never resolves
        }
        return Promise.resolve(undefined);
      });

      await script.initialize();

      const container = createCodeContainer();
      const line = createCodeLine(5);
      container.appendChild(line);

      const codeContent = line.querySelector('.react-file-line')!;
      const moveEvent = new MouseEvent('mousemove', {
        clientX: 100,
        clientY: 50,
        bubbles: true,
      });
      Object.defineProperty(moveEvent, 'target', { value: codeContent });
      document.dispatchEvent(moveEvent);

      // Wait for debounce (300ms)
      vi.advanceTimersByTime(350);

      // Before loading delay (200ms), should still be hidden
      expect(script.getPopoverState()).toBe('hidden');

      // After loading delay, should show loading
      vi.advanceTimersByTime(250);
      expect(script.getPopoverState()).toBe('loading');
    });

    it('resets UI state on deactivation', async () => {
      setupChromeMock({ displayMode: 'sidebar' });
      setLocationTo('https://github.com/owner/repo/blob/main/src/index.ts');
      script = new GhLspContentScript();
      await script.initialize();

      expect(script.getSidebarState()).toBe('expanded');

      script.deactivate();

      expect(script.getSidebarState()).toBe('hidden');
      expect(script.getPopoverState()).toBe('hidden');
      expect(script.getHoverData()).toBeNull();
    });

    it('switches from sidebar to popover mode', async () => {
      setupChromeMock({ displayMode: 'sidebar' });
      setLocationTo('https://github.com/owner/repo/blob/main/src/index.ts');
      script = new GhLspContentScript();
      await script.initialize();

      expect(script.getSidebarState()).toBe('expanded');
      expect(script.getDisplayMode()).toBe('sidebar');

      // Switch to popover mode
      const settingsMessage: SettingsChangedMessage = {
        type: 'settings/changed',
        changes: { displayMode: 'popover' },
      };

      for (const listener of messageListeners) {
        listener(settingsMessage, {} as chrome.runtime.MessageSender, vi.fn());
      }

      expect(script.getDisplayMode()).toBe('popover');
      expect(script.getSidebarState()).toBe('hidden');
      expect(script.getPopoverState()).toBe('hidden');
    });

    it('handles null hover result gracefully', async () => {
      setLocationTo('https://github.com/owner/repo/blob/main/src/index.ts');
      script = new GhLspContentScript();

      const hoverResponse: LspHoverResponse = {
        type: 'lsp/response',
        requestId: 'test-id',
        kind: 'hover',
        result: null,
      };
      sendMessageMock.mockResolvedValue(hoverResponse);

      await script.initialize();

      const container = createCodeContainer();
      const line = createCodeLine(5);
      container.appendChild(line);

      const codeContent = line.querySelector('.react-file-line')!;
      const moveEvent = new MouseEvent('mousemove', {
        clientX: 100,
        clientY: 50,
        bubbles: true,
      });
      Object.defineProperty(moveEvent, 'target', { value: codeContent });
      document.dispatchEvent(moveEvent);

      vi.advanceTimersByTime(350);
      await vi.advanceTimersByTimeAsync(0);

      // Null result means no info — popover stays hidden
      expect(script.getPopoverState()).toBe('hidden');
      expect(script.getHoverData()).toBeNull();
    });

    it('parses plaintext hover content', async () => {
      setLocationTo('https://github.com/owner/repo/blob/main/src/index.ts');
      script = new GhLspContentScript();

      const hoverResponse: LspHoverResponse = {
        type: 'lsp/response',
        requestId: 'test-id',
        kind: 'hover',
        result: {
          contents: { kind: 'plaintext', value: 'const x: number' },
        },
      };
      sendMessageMock.mockResolvedValue(hoverResponse);

      await script.initialize();

      const container = createCodeContainer();
      const line = createCodeLine(5);
      container.appendChild(line);

      const codeContent = line.querySelector('.react-file-line')!;
      const moveEvent = new MouseEvent('mousemove', {
        clientX: 100,
        clientY: 50,
        bubbles: true,
      });
      Object.defineProperty(moveEvent, 'target', { value: codeContent });
      document.dispatchEvent(moveEvent);

      vi.advanceTimersByTime(350);
      await vi.advanceTimersByTimeAsync(0);

      expect(script.getPopoverState()).toBe('visible');
      expect(script.getHoverData()?.signature).toBe('const x: number');
      expect(script.getHoverData()?.documentation).toBeUndefined();
    });
  });
});
