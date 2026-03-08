import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { h } from 'preact';
import { ExtensionMount } from '../../../src/ui/mount';

describe('ExtensionMount', () => {
  let mount: ExtensionMount;

  beforeEach(() => {
    mount = new ExtensionMount();
  });

  afterEach(() => {
    // Always clean up
    mount.destroy();
  });

  describe('create()', () => {
    it('creates a host element with id "gh-lsp-root"', () => {
      mount.create();
      const host = document.getElementById('gh-lsp-root');
      expect(host).not.toBeNull();
      expect(host?.tagName).toBe('DIV');
    });

    it('attaches an open shadow root to the host element', () => {
      const shadowRoot = mount.create();
      expect(shadowRoot).toBeInstanceOf(ShadowRoot);
      expect(shadowRoot.mode).toBe('open');
    });

    it('returns the shadow root', () => {
      const shadowRoot = mount.create();
      expect(shadowRoot).toBe(mount.getShadowRoot());
    });

    it('creates an internal container inside the shadow root', () => {
      const shadowRoot = mount.create();
      const container = shadowRoot.getElementById('gh-lsp-container');
      expect(container).not.toBeNull();
      expect(container?.tagName).toBe('DIV');
    });

    it('appends host element to document.body', () => {
      mount.create();
      const host = document.getElementById('gh-lsp-root');
      expect(host?.parentNode).toBe(document.body);
    });

    it('sets host element styles for non-interference with page layout', () => {
      mount.create();
      const host = mount.getHostElement()!;
      expect(host.style.position).toBe('absolute');
      expect(host.style.overflow).toBe('visible');
      expect(host.style.pointerEvents).toBe('none');
      expect(host.style.zIndex).toBe('2147483647');
    });

    it('sets container pointerEvents to auto for interactivity', () => {
      mount.create();
      const container = mount.getContainer()!;
      expect(container.style.pointerEvents).toBe('auto');
    });

    it('throws if called when already created', () => {
      mount.create();
      expect(() => mount.create()).toThrow('ExtensionMount is already created');
    });

    it('sets isActive to true after creation', () => {
      expect(mount.isActive()).toBe(false);
      mount.create();
      expect(mount.isActive()).toBe(true);
    });
  });

  describe('injectStyles()', () => {
    it('injects a <style> element into the shadow root', () => {
      const shadowRoot = mount.create();
      mount.injectStyles('.test { color: red; }');

      const styleElements = shadowRoot.querySelectorAll('style');
      expect(styleElements.length).toBe(1);
      expect(styleElements[0]!.textContent).toBe('.test { color: red; }');
    });

    it('places the style element before the container', () => {
      const shadowRoot = mount.create();
      mount.injectStyles('.test { color: red; }');

      const children = Array.from(shadowRoot.childNodes);
      const styleIndex = children.findIndex(
        (n) => n.nodeName === 'STYLE'
      );
      const containerIndex = children.findIndex(
        (n) => (n as Element).id === 'gh-lsp-container'
      );
      expect(styleIndex).toBeLessThan(containerIndex);
    });

    it('supports injecting multiple style blocks', () => {
      const shadowRoot = mount.create();
      mount.injectStyles('.a { color: red; }');
      mount.injectStyles('.b { color: blue; }');

      const styleElements = shadowRoot.querySelectorAll('style');
      expect(styleElements.length).toBe(2);
    });

    it('throws if mount has not been created', () => {
      expect(() => mount.injectStyles('.test {}')).toThrow(
        'ExtensionMount has not been created'
      );
    });
  });

  describe('render()', () => {
    it('renders a Preact component into the container', () => {
      mount.create();
      mount.render(h('div', { class: 'test-component' }, 'Hello'));

      const container = mount.getContainer()!;
      const rendered = container.querySelector('.test-component');
      expect(rendered).not.toBeNull();
      expect(rendered?.textContent).toBe('Hello');
    });

    it('replaces previous render content on re-render', () => {
      mount.create();
      mount.render(h('div', { class: 'first' }, 'First'));
      mount.render(h('div', { class: 'second' }, 'Second'));

      const container = mount.getContainer()!;
      expect(container.querySelector('.first')).toBeNull();
      expect(container.querySelector('.second')).not.toBeNull();
    });

    it('can render null to clear content', () => {
      mount.create();
      mount.render(h('div', { class: 'test' }, 'Content'));

      const container = mount.getContainer()!;
      expect(container.querySelector('.test')).not.toBeNull();

      mount.render(null);
      expect(container.querySelector('.test')).toBeNull();
    });

    it('throws if mount has not been created', () => {
      expect(() => mount.render(h('div', null, 'test'))).toThrow(
        'ExtensionMount has not been created'
      );
    });

    it('renders nested component trees', () => {
      mount.create();
      mount.render(
        h('div', { class: 'parent' },
          h('span', { class: 'child' }, 'Nested'),
          h('span', { class: 'sibling' }, 'Content')
        )
      );

      const container = mount.getContainer()!;
      const parent = container.querySelector('.parent');
      expect(parent).not.toBeNull();
      expect(parent?.querySelector('.child')?.textContent).toBe('Nested');
      expect(parent?.querySelector('.sibling')?.textContent).toBe('Content');
    });
  });

  describe('destroy()', () => {
    it('removes the host element from the DOM', () => {
      mount.create();
      expect(document.getElementById('gh-lsp-root')).not.toBeNull();

      mount.destroy();
      expect(document.getElementById('gh-lsp-root')).toBeNull();
    });

    it('sets isActive to false', () => {
      mount.create();
      expect(mount.isActive()).toBe(true);

      mount.destroy();
      expect(mount.isActive()).toBe(false);
    });

    it('clears all references', () => {
      mount.create();
      mount.destroy();

      expect(mount.getShadowRoot()).toBeNull();
      expect(mount.getContainer()).toBeNull();
      expect(mount.getHostElement()).toBeNull();
    });

    it('allows re-creating after destroy', () => {
      mount.create();
      mount.destroy();

      const shadowRoot = mount.create();
      expect(shadowRoot).toBeInstanceOf(ShadowRoot);
      expect(mount.isActive()).toBe(true);
    });

    it('is safe to call multiple times', () => {
      mount.create();
      mount.destroy();
      expect(() => mount.destroy()).not.toThrow();
    });

    it('is safe to call without create', () => {
      expect(() => mount.destroy()).not.toThrow();
    });

    it('unmounts Preact component tree', () => {
      mount.create();
      mount.render(h('div', { class: 'test' }, 'Content'));

      // Verify content exists before destroy
      const container = mount.getContainer()!;
      expect(container.querySelector('.test')).not.toBeNull();

      mount.destroy();
      // After destroy, host is removed from DOM entirely
      expect(document.getElementById('gh-lsp-root')).toBeNull();
    });
  });

  describe('style isolation', () => {
    it('shadow DOM prevents host page styles from affecting extension UI', () => {
      // Add a style to the host page
      const pageStyle = document.createElement('style');
      pageStyle.textContent = '.test-isolation { color: rgb(255, 0, 0); }';
      document.head.appendChild(pageStyle);

      mount.create();
      mount.render(h('div', { class: 'test-isolation' }, 'Test'));

      // The element inside shadow DOM should exist but not be affected
      // by the page-level style (in jsdom, computed styles don't cross shadow
      // boundaries, so we verify structural isolation)
      const container = mount.getContainer()!;
      const element = container.querySelector('.test-isolation');
      expect(element).not.toBeNull();

      // The shadow root's host is separate from the page
      const shadowRoot = mount.getShadowRoot()!;
      expect(shadowRoot.host).toBe(mount.getHostElement());

      // Clean up page style
      document.head.removeChild(pageStyle);
    });

    it('injected styles are scoped to shadow root', () => {
      mount.create();
      mount.injectStyles('.scoped-class { font-size: 14px; }');

      // Verify the style element is inside the shadow root, not the document
      const documentStyles = document.querySelectorAll('style');
      const hasScoped = Array.from(documentStyles).some(
        (s) => s.textContent?.includes('.scoped-class')
      );
      expect(hasScoped).toBe(false);

      const shadowStyles = mount.getShadowRoot()!.querySelectorAll('style');
      const hasScopedInShadow = Array.from(shadowStyles).some(
        (s) => s.textContent?.includes('.scoped-class')
      );
      expect(hasScopedInShadow).toBe(true);
    });
  });

  describe('getters', () => {
    it('getShadowRoot returns null before creation', () => {
      expect(mount.getShadowRoot()).toBeNull();
    });

    it('getContainer returns null before creation', () => {
      expect(mount.getContainer()).toBeNull();
    });

    it('getHostElement returns null before creation', () => {
      expect(mount.getHostElement()).toBeNull();
    });

    it('getShadowRoot returns shadow root after creation', () => {
      const shadowRoot = mount.create();
      expect(mount.getShadowRoot()).toBe(shadowRoot);
    });

    it('getContainer returns container after creation', () => {
      mount.create();
      const container = mount.getContainer();
      expect(container).not.toBeNull();
      expect(container?.id).toBe('gh-lsp-container');
    });

    it('getHostElement returns host element after creation', () => {
      mount.create();
      const host = mount.getHostElement();
      expect(host).not.toBeNull();
      expect(host?.id).toBe('gh-lsp-root');
    });
  });

  describe('setDataAttribute()', () => {
    it('sets a data attribute on the host element', () => {
      mount.create();
      mount.setDataAttribute('theme', 'dark');

      const host = mount.getHostElement()!;
      expect(host.dataset.theme).toBe('dark');
      expect(host.getAttribute('data-theme')).toBe('dark');
    });

    it('can update an existing data attribute', () => {
      mount.create();
      mount.setDataAttribute('theme', 'light');
      mount.setDataAttribute('theme', 'dark');

      const host = mount.getHostElement()!;
      expect(host.dataset.theme).toBe('dark');
    });

    it('is safe to call without host element', () => {
      expect(() => mount.setDataAttribute('theme', 'dark')).not.toThrow();
    });
  });
});
