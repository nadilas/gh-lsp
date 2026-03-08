/**
 * Content script entry point.
 *
 * Orchestrates page detection, DOM observation, token hover detection,
 * and messaging with the background service worker. Handles GitHub's
 * Turbo SPA navigation by tearing down and re-initializing when the
 * URL changes.
 */

import type {
  RepoContext,
  ExtensionSettings,
  LspHoverResponse,
  PageNavigatedMessage,
} from '@shared/types';
import { getSettings } from '@shared/settings';
import { LOADING_INDICATOR_DELAY_MS } from '@shared/constants';
import { detectPage, observeNavigation, refineBlobContext } from './page-detector';
import { observeCodeDom, findCodeContainers, findCodeLines } from './dom-observer';
import { createTokenDetector, type TokenHoverEvent } from './token-detector';
import { ContentMessaging } from './messaging';

// ─── Content Script State ──────────────────────────────────────────────────

/** Possible lifecycle states for the content script */
type ContentScriptState = 'dormant' | 'active' | 'disposed';

/**
 * Main content script class that ties together all content-side modules.
 *
 * Lifecycle:
 *   1. `initialize()` — detect page, load settings, wire up navigation listener
 *   2. `activate(context)` — start DOM observer, token detector, messaging
 *   3. `deactivate()` — tear down everything, cancel pending requests
 *   4. On Turbo navigation → deactivate → re-detect → maybe re-activate
 */
export class GhLspContentScript {
  private state: ContentScriptState = 'dormant';
  private context: RepoContext | null = null;
  private settings: ExtensionSettings | null = null;

  // Module instances
  private readonly messaging = new ContentMessaging();

  // Cleanup functions returned by module setup calls
  private stopNavigationObserver: (() => void) | null = null;
  private stopDomObserver: (() => void) | null = null;
  private stopTokenDetector: (() => void) | null = null;
  private stopListeningForNotifications: (() => void) | null = null;

  // Loading indicator timer — shows skeleton after a delay
  private loadingTimer: ReturnType<typeof setTimeout> | null = null;

  // Track the current in-flight hover request so we can cancel it
  private currentHoverRequestId: string | null = null;

  /**
   * Entry point: detect the current page, load settings, set up navigation
   * listening, and activate if on a code page.
   */
  async initialize(): Promise<void> {
    if (this.state === 'disposed') return;

    console.debug('[gh-lsp] Content script initializing');

    // Load settings
    try {
      this.settings = await getSettings();
    } catch {
      // Extension context may be invalidated; fall back to dormant
      console.warn('[gh-lsp] Could not load settings; staying dormant');
      return;
    }

    // If extension is disabled, stay dormant
    if (!this.settings.enabled) {
      console.debug('[gh-lsp] Extension is disabled');
      this.setupNavigationAndNotifications();
      return;
    }

    // Detect current page
    const detection = this.detectCurrentPage();

    // Set up Turbo navigation listener (always, even if not on code page)
    this.setupNavigationAndNotifications();

    // Activate if on a supported code page
    if (detection) {
      this.activate(detection.context);
    } else {
      console.debug('[gh-lsp] Not a supported code page; staying dormant');
    }
  }

  /**
   * Activates the content script for a detected code page. Starts DOM
   * observation, token hover detection, and notifies the background.
   */
  activate(context: RepoContext): void {
    if (this.state === 'disposed') return;

    // If already active, deactivate first
    if (this.state === 'active') {
      this.deactivate();
    }

    this.state = 'active';
    this.context = context;

    console.debug('[gh-lsp] Activating for', context.owner + '/' + context.repo, context.filePath);

    // Notify background of page navigation
    this.notifyPageNavigated(context);

    // Start DOM observer for code containers
    this.startDomObserver();

    // Start token hover detection
    this.startTokenDetector();
  }

  /**
   * Deactivates the content script: stops observers, cancels pending
   * requests, and clears all state. The script goes dormant and can
   * be re-activated on the next navigation.
   */
  deactivate(): void {
    if (this.state !== 'active') return;

    console.debug('[gh-lsp] Deactivating');

    // Cancel any in-flight hover request
    this.cancelCurrentHover();

    // Clear loading timer
    this.clearLoadingTimer();

    // Stop token detector
    if (this.stopTokenDetector) {
      this.stopTokenDetector();
      this.stopTokenDetector = null;
    }

    // Stop DOM observer
    if (this.stopDomObserver) {
      this.stopDomObserver();
      this.stopDomObserver = null;
    }

    // Cancel all pending messaging requests
    this.messaging.cancelAll();

    this.context = null;
    this.state = 'dormant';
  }

  /**
   * Fully disposes the content script. Used when the extension is unloaded.
   * After disposal the instance cannot be re-used.
   */
  dispose(): void {
    this.deactivate();

    // Stop navigation observer
    if (this.stopNavigationObserver) {
      this.stopNavigationObserver();
      this.stopNavigationObserver = null;
    }

    // Stop notification listener
    if (this.stopListeningForNotifications) {
      this.stopListeningForNotifications();
      this.stopListeningForNotifications = null;
    }

    this.messaging.dispose();
    this.state = 'disposed';
  }

  /** Returns the current lifecycle state */
  getState(): ContentScriptState {
    return this.state;
  }

  /** Returns the current repo context (null when dormant) */
  getContext(): RepoContext | null {
    return this.context;
  }

  // ─── Private: Setup Helpers ──────────────────────────────────────────────

  /**
   * Detects the current page type and returns the detection result,
   * refining blob context using DOM-based ref extraction.
   */
  private detectCurrentPage() {
    const url = window.location.href;
    let detection = detectPage(url);
    if (!detection) return null;

    // Refine blob view context using DOM ref selector
    if (detection.viewType === 'blob') {
      try {
        const pathname = new URL(url).pathname;
        detection = refineBlobContext(detection, pathname);
      } catch {
        // URL parsing failed, use as-is
      }
    }

    return detection;
  }

  /**
   * Sets up the Turbo/popstate navigation listener and background
   * notification listener. These run regardless of whether the current
   * page is a code page, because the user may navigate to one.
   */
  private setupNavigationAndNotifications(): void {
    // Navigation observer for Turbo/pjax/popstate
    if (!this.stopNavigationObserver) {
      this.stopNavigationObserver = observeNavigation((url: string) => {
        this.handleNavigation(url);
      });
    }

    // Background notification listener
    if (!this.stopListeningForNotifications) {
      this.stopListeningForNotifications = this.messaging.startListening({
        onSettingsChanged: (message) => {
          this.handleSettingsChanged(message.changes);
        },
        onExtensionToggle: (message) => {
          this.handleExtensionToggle(message.enabled);
        },
        onRateLimitWarning: (_message) => {
          // Future: display rate limit warning in UI (Phase 6+)
          console.warn('[gh-lsp] Rate limit warning received');
        },
        onWorkerStatus: (_message) => {
          // Future: update status indicator in UI (Phase 6+)
        },
      });
    }
  }

  /**
   * Handles Turbo/SPA navigation: tear down current state and re-detect.
   */
  private handleNavigation(url: string): void {
    console.debug('[gh-lsp] Navigation detected:', url);

    // Deactivate current page
    this.deactivate();

    // If extension is disabled, don't try to re-activate
    if (this.settings && !this.settings.enabled) return;

    // Detect new page
    const detection = this.detectCurrentPage();

    if (detection) {
      this.activate(detection.context);
    } else {
      // Notify background that we left a code page
      this.notifyPageNavigated(null);
    }
  }

  /**
   * Handles settings changes propagated from the background.
   */
  private handleSettingsChanged(changes: Partial<ExtensionSettings>): void {
    if (!this.settings) return;

    // Merge changes into local settings
    this.settings = { ...this.settings, ...changes };

    // If debounce changed, restart token detector with new timing
    if (changes.hoverDebounceMs !== undefined && this.state === 'active') {
      if (this.stopTokenDetector) {
        this.stopTokenDetector();
        this.stopTokenDetector = null;
      }
      this.startTokenDetector();
    }

    // If display mode changed, the UI layer will handle the switch (Phase 6+)
    // For now just log
    if (changes.displayMode !== undefined) {
      console.debug('[gh-lsp] Display mode changed to:', changes.displayMode);
    }

    // If enabled languages changed, nothing to do here — the background
    // handles language filtering when routing requests
  }

  /**
   * Handles the extension being toggled on/off.
   */
  private handleExtensionToggle(enabled: boolean): void {
    if (this.settings) {
      this.settings.enabled = enabled;
    }

    if (enabled) {
      // Re-detect and possibly activate
      const detection = this.detectCurrentPage();
      if (detection) {
        this.activate(detection.context);
      }
    } else {
      this.deactivate();
    }
  }

  // ─── Private: DOM Observation ────────────────────────────────────────────

  /**
   * Starts observing the DOM for code containers and lines.
   * Also processes any existing code containers on the page.
   */
  private startDomObserver(): void {
    this.stopDomObserver = observeCodeDom({
      onLinesAdded: (_lines) => {
        // Lines are handled by the token detector via event delegation
        // (mousemove on document), so no per-line setup needed.
      },
      onLinesRemoved: (_lines) => {
        // Token detector uses event delegation, so no per-line cleanup needed.
      },
      onCodeContainerAdded: (_container) => {
        // Future: could pre-scan container for language detection
      },
    });

    // Process existing code containers
    const containers = findCodeContainers();
    for (const container of containers) {
      const _lines = findCodeLines(container);
      // Lines are handled by the token detector's event delegation
    }
  }

  // ─── Private: Token Detection ────────────────────────────────────────────

  /**
   * Starts the token hover detector with the current debounce setting.
   */
  private startTokenDetector(): void {
    const debounceMs = this.settings?.hoverDebounceMs;

    this.stopTokenDetector = createTokenDetector(
      (event) => this.handleTokenHover(event),
      () => this.handleTokenLeave(),
      { debounceMs },
    );
  }

  /**
   * Called when the user hovers over a code token long enough for the
   * debounce to fire. Sends a hover request to the background.
   */
  private handleTokenHover(event: TokenHoverEvent): void {
    if (this.state !== 'active' || !this.context) return;

    // Cancel any previous in-flight hover
    this.cancelCurrentHover();

    // Start loading indicator timer
    this.startLoadingTimer();

    // Send hover request
    const promise = this.messaging.sendHoverRequest(
      this.context,
      event.position,
    );

    // Track the request ID for cancellation.
    // The ContentMessaging class generates the requestId internally,
    // so we get it by inspecting the pending count before/after, but
    // a simpler approach: since sendHoverRequest returns a promise,
    // we track the promise completion.
    //
    // We use a generation counter to detect stale responses.
    const hoverGeneration = Symbol();
    (this as unknown as Record<symbol, symbol>)[hoverGeneration] = hoverGeneration;
    this.currentHoverRequestId = hoverGeneration.toString();

    promise
      .then((response: LspHoverResponse) => {
        // Check if this response is still relevant (not cancelled/superseded)
        if (this.state !== 'active') return;

        this.clearLoadingTimer();
        this.handleHoverResponse(response, event);
      })
      .catch((error: unknown) => {
        this.clearLoadingTimer();

        // Cancelled requests are expected — don't log them as errors
        if (error instanceof Error && error.message.includes('cancelled')) {
          return;
        }

        // Timeout or other error
        if (error instanceof Error && error.message.includes('timed out')) {
          console.warn('[gh-lsp] Hover request timed out');
          // Future: show timeout indicator in UI (Phase 6+)
          return;
        }

        console.error('[gh-lsp] Hover request failed:', error);
        // Future: show error state in UI (Phase 6+)
      });
  }

  /**
   * Called when the mouse leaves a code token. Cancels any in-flight
   * hover request and hides the popover/indicator.
   */
  private handleTokenLeave(): void {
    this.cancelCurrentHover();
    this.clearLoadingTimer();
    // Future: trigger popover dismiss with fade-out (Phase 6+)
  }

  /**
   * Processes a successful hover response from the background.
   */
  private handleHoverResponse(
    response: LspHoverResponse,
    _event: TokenHoverEvent,
  ): void {
    if (!response.result) {
      // No hover info at this position — nothing to display
      return;
    }

    // Future: render hover data in popover or sidebar (Phase 6+)
    // For now, log the result for debugging
    console.debug('[gh-lsp] Hover result:', response.result.contents.value);
  }

  // ─── Private: Request Management ─────────────────────────────────────────

  /**
   * Cancels the current in-flight hover request, if any.
   */
  private cancelCurrentHover(): void {
    if (this.currentHoverRequestId) {
      this.currentHoverRequestId = null;
      // Cancel all pending — in practice there's only one hover at a time
      this.messaging.cancelAll();
    }
  }

  // ─── Private: Loading Indicator ──────────────────────────────────────────

  /**
   * Starts the loading indicator timer. The indicator is shown only
   * after a delay to avoid flicker on fast responses.
   */
  private startLoadingTimer(): void {
    this.clearLoadingTimer();
    this.loadingTimer = setTimeout(() => {
      this.loadingTimer = null;
      // Future: show loading skeleton in popover (Phase 6+)
    }, LOADING_INDICATOR_DELAY_MS);
  }

  /**
   * Clears the loading indicator timer and hides the indicator.
   */
  private clearLoadingTimer(): void {
    if (this.loadingTimer !== null) {
      clearTimeout(this.loadingTimer);
      this.loadingTimer = null;
    }
  }

  // ─── Private: Background Messaging ───────────────────────────────────────

  /**
   * Notifies the background service worker of a page navigation event.
   */
  private notifyPageNavigated(context: RepoContext | null): void {
    const message: PageNavigatedMessage = {
      type: 'page/navigated',
      newContext: context,
    };

    chrome.runtime.sendMessage(message).catch(() => {
      // Extension context may be invalidated
    });
  }
}

// ─── Self-executing initialization ─────────────────────────────────────────

const extension = new GhLspContentScript();
void extension.initialize();
