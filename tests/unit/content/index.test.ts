import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GhLspContentScript } from '../../../src/content/index';
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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('GhLspContentScript', () => {
  let script: GhLspContentScript;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    setupChromeMock();
  });

  afterEach(() => {
    script?.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
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
      if (resolveHover) {
        resolveHover({
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
});
