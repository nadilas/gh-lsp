import { render, type ComponentChild } from 'preact';

/**
 * Manages the Shadow DOM mount point for the gh-lsp extension UI.
 * Provides style isolation so GitHub styles don't leak in and extension
 * styles don't leak out.
 */
export class ExtensionMount {
  private hostElement: HTMLDivElement | null = null;
  private shadowRoot: ShadowRoot | null = null;
  private container: HTMLDivElement | null = null;

  /**
   * Creates the Shadow DOM host element and attaches a shadow root.
   * Appends the host to document.body and creates an internal container
   * for Preact rendering.
   *
   * @returns The created ShadowRoot
   * @throws If called when already mounted
   */
  create(): ShadowRoot {
    if (this.shadowRoot) {
      throw new Error('ExtensionMount is already created. Call destroy() first.');
    }

    // Create host element
    this.hostElement = document.createElement('div');
    this.hostElement.id = 'gh-lsp-root';
    // Ensure the host element doesn't interfere with page layout
    this.hostElement.style.position = 'absolute';
    this.hostElement.style.top = '0';
    this.hostElement.style.left = '0';
    this.hostElement.style.width = '0';
    this.hostElement.style.height = '0';
    this.hostElement.style.overflow = 'visible';
    this.hostElement.style.pointerEvents = 'none';
    this.hostElement.style.zIndex = '2147483647';

    // Attach shadow DOM for style isolation
    this.shadowRoot = this.hostElement.attachShadow({ mode: 'open' });

    // Create internal container for Preact rendering
    this.container = document.createElement('div');
    this.container.id = 'gh-lsp-container';
    this.container.style.pointerEvents = 'auto';
    this.shadowRoot.appendChild(this.container);

    // Append to body
    document.body.appendChild(this.hostElement);

    return this.shadowRoot;
  }

  /**
   * Injects CSS styles into the shadow root via a <style> element.
   * This ensures styles are scoped to the shadow DOM and isolated
   * from the host page.
   *
   * @param css - The CSS string to inject
   * @throws If the mount has not been created yet
   */
  injectStyles(css: string): void {
    if (!this.shadowRoot) {
      throw new Error('ExtensionMount has not been created. Call create() first.');
    }

    const styleElement = document.createElement('style');
    styleElement.textContent = css;
    // Insert styles before the container so they take effect
    this.shadowRoot.insertBefore(styleElement, this.container);
  }

  /**
   * Renders a Preact component tree into the shadow DOM container.
   *
   * @param component - The Preact VNode to render
   * @throws If the mount has not been created yet
   */
  render(component: ComponentChild): void {
    if (!this.container) {
      throw new Error('ExtensionMount has not been created. Call create() first.');
    }

    render(component, this.container);
  }

  /**
   * Unmounts the Preact component tree and removes the host element
   * from the DOM, cleaning up all resources.
   */
  destroy(): void {
    // Unmount Preact component tree
    if (this.container) {
      render(null, this.container);
    }

    // Remove host element from DOM
    if (this.hostElement?.parentNode) {
      this.hostElement.parentNode.removeChild(this.hostElement);
    }

    this.container = null;
    this.shadowRoot = null;
    this.hostElement = null;
  }

  /**
   * Returns the shadow root, or null if not created.
   */
  getShadowRoot(): ShadowRoot | null {
    return this.shadowRoot;
  }

  /**
   * Returns the internal container element, or null if not created.
   */
  getContainer(): HTMLDivElement | null {
    return this.container;
  }

  /**
   * Returns the host element, or null if not created.
   */
  getHostElement(): HTMLDivElement | null {
    return this.hostElement;
  }

  /**
   * Returns whether the mount is currently active.
   */
  isActive(): boolean {
    return this.shadowRoot !== null;
  }

  /**
   * Sets a data attribute on the host element, useful for theme switching.
   *
   * @param name - The attribute name (without 'data-' prefix)
   * @param value - The attribute value
   */
  setDataAttribute(name: string, value: string): void {
    if (this.hostElement) {
      this.hostElement.dataset[name] = value;
    }
  }
}
