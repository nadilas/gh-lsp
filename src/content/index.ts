/**
 * Content script entry point.
 *
 * Orchestrates page detection, DOM observation, token hover detection,
 * messaging with the background service worker, and UI rendering
 * (popover or sidebar). Handles GitHub's Turbo SPA navigation by
 * tearing down and re-initializing when the URL changes.
 */

import { h } from 'preact';
import type {
  RepoContext,
  ExtensionSettings,
  LspHoverResponse,
  LspHover,
  PageNavigatedMessage,
  PopoverState,
  SidebarState,
  PopoverPosition,
  HoverDisplayData,
  ExtensionError,
  DetectedTheme,
  SupportedLanguage,
} from '@shared/types';
import { getSettings } from '@shared/settings';
import { LOADING_INDICATOR_DELAY_MS } from '@shared/constants';
import browser from '@shared/browser';
import { detectPage, observeNavigation, refineBlobContext } from './page-detector';
import { observeCodeDom, findCodeContainers, findCodeLines } from './dom-observer';
import { createTokenDetector, type TokenHoverEvent } from './token-detector';
import { ContentMessaging } from './messaging';
import { ExtensionMount } from '@ui/mount';
import { Popover } from '@ui/popover/Popover';
import { Sidebar } from '@ui/sidebar/Sidebar';
import { calculatePopoverPosition } from '@ui/popover/positioning';
import { detectTheme, onThemeChange } from '@ui/theme';
import themeCSS from '@ui/styles/theme.css?inline';

// ─── Content Script State ──────────────────────────────────────────────────

/** Possible lifecycle states for the content script */
type ContentScriptState = 'dormant' | 'active' | 'disposed';

/**
 * Main content script class that ties together all content-side modules.
 *
 * Lifecycle:
 *   1. `initialize()` — detect page, load settings, wire up navigation listener
 *   2. `activate(context)` — start DOM observer, token detector, messaging, UI
 *   3. `deactivate()` — tear down everything, cancel pending requests, destroy UI
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
  private stopCommandListener: (() => void) | null = null;

  // Loading indicator timer — shows skeleton after a delay
  private loadingTimer: ReturnType<typeof setTimeout> | null = null;

  // Track the current in-flight hover request so we can cancel it
  private currentHoverRequestId: string | null = null;

  // ── UI State ─────────────────────────────────────────────────────────────

  /** Shadow DOM mount point for the extension UI */
  private mount: ExtensionMount | null = null;

  /** Theme change listener cleanup */
  private stopThemeListener: (() => void) | null = null;

  /** Current detected GitHub theme */
  private currentTheme: DetectedTheme = 'light';

  // Popover state
  private popoverState: PopoverState = 'hidden';
  private popoverPosition: PopoverPosition | null = null;
  private currentTokenRect: DOMRect | null = null;

  // Sidebar state
  private sidebarState: SidebarState = 'hidden';

  // Shared display state (used by both popover and sidebar)
  private hoverData: HoverDisplayData | null = null;
  private hoverError: ExtensionError | null = null;
  private isLoadingUI = false;

  // Last hover event — retained for retry
  private lastHoverEvent: TokenHoverEvent | null = null;

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
   * observation, token hover detection, messaging, and creates the UI.
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

    // Create UI (popover or sidebar in shadow DOM)
    this.createUI();
  }

  /**
   * Deactivates the content script: stops observers, cancels pending
   * requests, destroys UI, and clears all state. The script goes dormant
   * and can be re-activated on the next navigation.
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

    // Destroy UI
    this.destroyUI();

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

    // Stop command listener
    if (this.stopCommandListener) {
      this.stopCommandListener();
      this.stopCommandListener = null;
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

  /** Returns the current display mode from settings */
  getDisplayMode(): string {
    return this.settings?.displayMode ?? 'popover';
  }

  /** Returns the current sidebar state */
  getSidebarState(): SidebarState {
    return this.sidebarState;
  }

  /** Returns the current popover state */
  getPopoverState(): PopoverState {
    return this.popoverState;
  }

  /** Returns the current hover display data (if any) */
  getHoverData(): HoverDisplayData | null {
    return this.hoverData;
  }

  // ─── Private: UI Lifecycle ──────────────────────────────────────────────

  /**
   * Creates the Shadow DOM mount point and initializes the UI layer.
   * Injects theme CSS and starts theme change detection.
   */
  private createUI(): void {
    if (this.mount) return;

    this.mount = new ExtensionMount();
    this.mount.create();
    this.mount.injectStyles(themeCSS);

    // Detect and apply theme
    this.currentTheme = detectTheme();
    this.mount.setDataAttribute('theme', this.currentTheme);

    // Watch for theme changes
    this.stopThemeListener = onThemeChange((theme) => {
      this.currentTheme = theme;
      this.mount?.setDataAttribute('theme', theme);
    });

    // Initialize display mode state
    const displayMode = this.settings?.displayMode ?? 'popover';
    if (displayMode === 'sidebar') {
      this.sidebarState = 'expanded';
    }

    this.renderUI();
  }

  /**
   * Destroys the UI layer, cleaning up theme listeners and the shadow DOM mount.
   */
  private destroyUI(): void {
    if (this.stopThemeListener) {
      this.stopThemeListener();
      this.stopThemeListener = null;
    }

    if (this.mount) {
      this.mount.destroy();
      this.mount = null;
    }

    // Reset UI state
    this.popoverState = 'hidden';
    this.popoverPosition = null;
    this.currentTokenRect = null;
    this.sidebarState = 'hidden';
    this.hoverData = null;
    this.hoverError = null;
    this.isLoadingUI = false;
    this.lastHoverEvent = null;
  }

  /**
   * Renders the appropriate UI component (Popover or Sidebar) into the
   * shadow DOM based on the current display mode and state.
   */
  private renderUI(): void {
    if (!this.mount) return;

    const displayMode = this.settings?.displayMode ?? 'popover';

    if (displayMode === 'popover') {
      this.mount.render(
        h(Popover, {
          state: this.popoverState,
          data: this.hoverData,
          error: this.hoverError,
          position: this.popoverPosition,
          onDismiss: () => this.dismissPopover(),
          onPin: () => this.pinPopover(),
          onRetry: () => this.retryHover(),
        }),
      );
    } else {
      this.mount.render(
        h(Sidebar, {
          position: this.settings?.sidebarPosition ?? 'right',
          state: this.sidebarState,
          data: this.hoverData,
          error: this.hoverError,
          loading: this.isLoadingUI,
          onToggle: () => this.toggleSidebar(),
          onRetry: () => this.retryHover(),
          onDismiss: () => {
            this.hoverError = null;
            this.renderUI();
          },
          size: this.settings?.sidebarSize,
          onSizeChange: (size: number) => {
            if (this.settings) {
              this.settings.sidebarSize = size;
            }
          },
        }),
      );
    }
  }

  // ─── Private: Popover Controls ──────────────────────────────────────────

  /** Dismisses the popover and clears hover data */
  private dismissPopover(): void {
    this.popoverState = 'hidden';
    this.hoverData = null;
    this.hoverError = null;
    this.popoverPosition = null;
    this.currentTokenRect = null;
    this.isLoadingUI = false;
    this.renderUI();
  }

  /** Toggles popover pin state */
  private pinPopover(): void {
    if (this.popoverState === 'visible') {
      this.popoverState = 'pinned';
    } else if (this.popoverState === 'pinned') {
      this.popoverState = 'visible';
    }
    this.renderUI();
  }

  // ─── Private: Sidebar Controls ──────────────────────────────────────────

  /** Toggles sidebar collapse/expand */
  private toggleSidebar(): void {
    if (this.sidebarState === 'expanded') {
      this.sidebarState = 'collapsed';
    } else if (this.sidebarState === 'collapsed') {
      this.sidebarState = 'expanded';
    }
    this.renderUI();
  }

  // ─── Private: Hover Retry ──────────────────────────────────────────────

  /** Retries the last hover request */
  private retryHover(): void {
    if (this.lastHoverEvent && this.context) {
      this.handleTokenHover(this.lastHoverEvent);
    }
  }

  // ─── Private: Display Mode Switch ──────────────────────────────────────

  /**
   * Switches the display mode between popover and sidebar without
   * requiring a page reload. Resets the current UI state and re-renders
   * in the new mode.
   */
  private switchDisplayMode(): void {
    if (!this.mount) return;

    const displayMode = this.settings?.displayMode ?? 'popover';

    // Reset state for the mode we're leaving
    this.popoverState = 'hidden';
    this.popoverPosition = null;
    this.currentTokenRect = null;
    this.hoverData = null;
    this.hoverError = null;
    this.isLoadingUI = false;

    // Initialize state for the mode we're entering
    if (displayMode === 'sidebar') {
      this.sidebarState = 'expanded';
    } else {
      this.sidebarState = 'hidden';
    }

    this.renderUI();
  }

  // ─── Private: Popover Positioning ──────────────────────────────────────

  /**
   * Gets a DOMRect for the hovered token element, used for popover positioning.
   * Tries to use `elementFromPoint` for the actual token element, falling back
   * to the line element's bounding rect.
   */
  private getTokenRect(event: TokenHoverEvent): DOMRect {
    try {
      const element = document.elementFromPoint(event.clientX, event.clientY);
      if (element && element !== document.documentElement && element !== document.body) {
        return element.getBoundingClientRect();
      }
    } catch {
      // elementFromPoint may not be available in some environments
    }
    // Fallback: use the line element
    return event.lineElement.getBoundingClientRect();
  }

  /**
   * Calculates the popover position from the stored token rect.
   */
  private calculatePosition(): PopoverPosition | null {
    if (!this.currentTokenRect) return null;

    const estimatedWidth = 400;
    const estimatedHeight = 200;

    return calculatePopoverPosition({
      tokenRect: this.currentTokenRect,
      popoverWidth: estimatedWidth,
      popoverHeight: estimatedHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      scrollY: window.scrollY,
      stickyHeaderHeight: 0,
    });
  }

  // ─── Private: Hover Data Conversion ────────────────────────────────────

  /**
   * Converts an LSP hover result into the HoverDisplayData format
   * expected by the UI components.
   *
   * Parses markdown hover content to separate the code signature
   * (from code blocks) from documentation text.
   */
  private convertHoverToDisplayData(
    hover: LspHover,
    language: SupportedLanguage,
  ): HoverDisplayData {
    const value = hover.contents.value;
    let signature = value;
    let documentation: string | undefined;

    if (hover.contents.kind === 'markdown') {
      // Extract the first code block as the type signature
      const codeBlockRegex = /^```\w*\n([\s\S]*?)\n```/m;
      const match = value.match(codeBlockRegex);
      if (match) {
        signature = match[1]?.trim() ?? value;
        const endOfBlock = (match.index ?? 0) + match[0].length;
        const rest = value.slice(endOfBlock).trim();
        if (rest) documentation = rest;
      }
    }

    return {
      signature,
      language,
      documentation,
    };
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
          console.warn('[gh-lsp] Rate limit warning received');
        },
        onWorkerStatus: (_message) => {
          // Future: update status indicator in UI
        },
      });
    }

    // Keyboard command listener (pin-popover forwarded from background)
    if (!this.stopCommandListener) {
      const commandListener = (message: unknown): void => {
        if (
          message !== null &&
          typeof message === 'object' &&
          'command' in message
        ) {
          const cmd = (message as { command: string }).command;
          if (cmd === 'pin-popover') {
            this.pinPopover();
          }
        }
      };

      browser.runtime.onMessage.addListener(commandListener);
      this.stopCommandListener = () => {
        browser.runtime.onMessage.removeListener(commandListener);
      };
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

    // If display mode changed, switch the UI
    if (changes.displayMode !== undefined && this.state === 'active') {
      console.debug('[gh-lsp] Display mode changed to:', changes.displayMode);
      this.switchDisplayMode();
    }

    // If sidebar position or size changed, re-render
    if (
      (changes.sidebarPosition !== undefined || changes.sidebarSize !== undefined) &&
      this.state === 'active'
    ) {
      this.renderUI();
    }
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
      findCodeLines(container);
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
   * debounce to fire. Sends a hover request to the background and
   * updates the UI with loading state.
   */
  private handleTokenHover(event: TokenHoverEvent): void {
    if (this.state !== 'active' || !this.context) return;

    // Cancel any previous in-flight hover
    this.cancelCurrentHover();

    // Store the event for retry
    this.lastHoverEvent = event;

    // Calculate token rect for popover positioning
    const displayMode = this.settings?.displayMode ?? 'popover';
    if (displayMode === 'popover') {
      this.currentTokenRect = this.getTokenRect(event);
      this.popoverPosition = this.calculatePosition();
    }

    // Start loading indicator timer
    this.startLoadingTimer();

    // Send hover request
    const promise = this.messaging.sendHoverRequest(
      this.context,
      event.position,
    );

    // Track request generation for staleness detection
    const hoverGeneration = Symbol();
    (this as unknown as Record<symbol, symbol>)[hoverGeneration] = hoverGeneration;
    this.currentHoverRequestId = hoverGeneration.toString();

    promise
      .then((response: LspHoverResponse) => {
        // Check if this response is still relevant (not cancelled/superseded)
        if (this.state !== 'active') return;

        this.clearLoadingTimer();
        this.handleHoverResponse(response);
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
          this.showError({
            code: 'lsp_timeout',
            message: 'Request timed out',
          });
          return;
        }

        console.error('[gh-lsp] Hover request failed:', error);
        this.showError({
          code: 'lsp_server_error',
          message: error instanceof Error ? error.message : 'An error occurred',
        });
      });
  }

  /**
   * Called when the mouse leaves a code token. Cancels any in-flight
   * hover request and hides the loading indicator.
   *
   * For popover mode: the popover stays visible so the user can
   * interact with it. It dismisses itself via its own mouse leave
   * handler, scroll listener, or escape key.
   *
   * For sidebar mode: the data stays in the sidebar until the next hover.
   */
  private handleTokenLeave(): void {
    this.cancelCurrentHover();
    this.clearLoadingTimer();

    // Clear loading state in UI if still loading
    if (this.isLoadingUI) {
      this.isLoadingUI = false;
      const displayMode = this.settings?.displayMode ?? 'popover';
      if (displayMode === 'popover' && this.popoverState === 'loading') {
        this.popoverState = 'hidden';
      }
      this.renderUI();
    }
  }

  /**
   * Processes a successful hover response from the background and
   * displays the result in the UI.
   */
  private handleHoverResponse(response: LspHoverResponse): void {
    if (!response.result) {
      // No hover info at this position — hide loading state
      const displayMode = this.settings?.displayMode ?? 'popover';
      if (displayMode === 'popover') {
        this.popoverState = 'hidden';
      }
      this.isLoadingUI = false;
      this.renderUI();
      return;
    }

    // Convert LSP result to display data
    const language = (this.context?.language ?? 'typescript') as SupportedLanguage;
    const displayData = this.convertHoverToDisplayData(response.result, language);

    this.hoverData = displayData;
    this.hoverError = null;
    this.isLoadingUI = false;

    const displayMode = this.settings?.displayMode ?? 'popover';
    if (displayMode === 'popover') {
      this.popoverState = 'visible';
      // Recalculate position in case viewport changed
      if (this.currentTokenRect) {
        this.popoverPosition = this.calculatePosition();
      }
    }

    console.debug('[gh-lsp] Hover result:', displayData.signature);
    this.renderUI();
  }

  /**
   * Shows an error state in the UI.
   */
  private showError(error: ExtensionError): void {
    this.hoverData = null;
    this.hoverError = error;
    this.isLoadingUI = false;

    const displayMode = this.settings?.displayMode ?? 'popover';
    if (displayMode === 'popover') {
      this.popoverState = 'error';
    }

    this.renderUI();
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
      this.isLoadingUI = true;

      const displayMode = this.settings?.displayMode ?? 'popover';
      if (displayMode === 'popover') {
        this.popoverState = 'loading';
      }

      this.renderUI();
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

    browser.runtime.sendMessage(message).catch(() => {
      // Extension context may be invalidated
    });
  }
}

// ─── Self-executing initialization ─────────────────────────────────────────

const extension = new GhLspContentScript();
void extension.initialize();
