import { describe, it, expect, afterEach } from 'vitest';
import { h, render } from 'preact';
import { MarkdownRenderer } from '../../../../src/ui/components/MarkdownRenderer';

function renderComponent(props: { content: string; className?: string }): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  render(h(MarkdownRenderer, props), container);
  return container;
}

describe('MarkdownRenderer', () => {
  let container: HTMLElement;

  afterEach(() => {
    if (container?.parentNode) {
      render(null, container);
      container.parentNode.removeChild(container);
    }
  });

  describe('XSS prevention', () => {
    it('strips <script> tags from content', () => {
      container = renderComponent({
        content: '<script>alert("xss")</script>hello',
      });

      const html = container.innerHTML;
      expect(html).not.toContain('<script');
      expect(html).not.toContain('alert');
      expect(html).toContain('hello');
    });

    it('strips javascript: href schemes from links', () => {
      container = renderComponent({
        content: '<a href="javascript:alert(1)">click</a>',
      });

      const link = container.querySelector('a');
      // DOMPurify strips the javascript: href — href is either removed (null) or sanitized
      if (link) {
        const href = link.getAttribute('href');
        expect(href === null || !href.includes('javascript:')).toBe(true);
      }
    });

    it('strips onerror event attributes from elements', () => {
      container = renderComponent({
        content: '<a href="#" onerror="alert(1)">test</a>',
      });

      const html = container.innerHTML;
      expect(html).not.toContain('onerror');
    });

    it('strips onclick event attributes', () => {
      container = renderComponent({
        content: '<a href="#" onclick="alert(1)">test</a>',
      });

      const html = container.innerHTML;
      expect(html).not.toContain('onclick');
    });

    it('strips <img> tags (not in ALLOWED_TAGS)', () => {
      container = renderComponent({
        content: '<img src="x" onerror="alert(1)">',
      });

      const img = container.querySelector('img');
      expect(img).toBeNull();
    });

    it('strips <iframe> tags', () => {
      container = renderComponent({
        content: '<iframe src="https://evil.com"></iframe>',
      });

      const iframe = container.querySelector('iframe');
      expect(iframe).toBeNull();
    });
  });

  describe('markdown rendering', () => {
    it('renders **bold** as <strong>', () => {
      container = renderComponent({ content: '**bold text**' });
      const strong = container.querySelector('strong');
      expect(strong).not.toBeNull();
      expect(strong?.textContent).toBe('bold text');
    });

    it('renders inline `code` as <code>', () => {
      container = renderComponent({ content: 'use `myFunction()` here' });
      const code = container.querySelector('code');
      expect(code).not.toBeNull();
      expect(code?.textContent).toBe('myFunction()');
    });

    it('renders fenced code blocks as <pre><code>', () => {
      container = renderComponent({
        content: '```ts\nconst x = 1;\n```',
      });
      const pre = container.querySelector('pre');
      expect(pre).not.toBeNull();
      const code = pre?.querySelector('code');
      expect(code).not.toBeNull();
      expect(code?.textContent).toContain('const x = 1;');
    });

    it('renders links with href preserved', () => {
      container = renderComponent({
        content: '[docs](https://example.com)',
      });
      const link = container.querySelector('a');
      expect(link).not.toBeNull();
      expect(link?.getAttribute('href')).toBe('https://example.com');
      expect(link?.textContent).toBe('docs');
    });

    it('renders empty string without error', () => {
      container = renderComponent({ content: '' });
      const docDiv = container.querySelector('.gh-lsp-popover__documentation');
      expect(docDiv).not.toBeNull();
    });
  });

  describe('className prop', () => {
    it('appends custom className to base class', () => {
      container = renderComponent({
        content: 'test',
        className: 'custom-class',
      });
      const docDiv = container.querySelector('.gh-lsp-popover__documentation');
      expect(docDiv).not.toBeNull();
      expect(docDiv?.className).toContain('gh-lsp-popover__documentation');
      expect(docDiv?.className).toContain('custom-class');
    });

    it('uses only base class when className is omitted', () => {
      container = renderComponent({ content: 'test' });
      const docDiv = container.querySelector('.gh-lsp-popover__documentation');
      expect(docDiv).not.toBeNull();
      expect(docDiv?.className).toBe('gh-lsp-popover__documentation');
    });
  });

  describe('memoization', () => {
    it('re-renders with new content when content prop changes', () => {
      container = document.createElement('div');
      document.body.appendChild(container);

      render(h(MarkdownRenderer, { content: '**first**' }), container);
      expect(container.querySelector('strong')?.textContent).toBe('first');

      render(h(MarkdownRenderer, { content: '**second**' }), container);
      expect(container.querySelector('strong')?.textContent).toBe('second');
    });
  });
});
