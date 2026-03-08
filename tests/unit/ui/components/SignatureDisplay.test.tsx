import { describe, it, expect, afterEach } from 'vitest';
import { h, render } from 'preact';
import { SignatureDisplay } from '../../../../src/ui/components/SignatureDisplay';
import type { SupportedLanguage } from '../../../../src/shared/types';

function renderComponent(signature: string, language: SupportedLanguage): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  render(h(SignatureDisplay, { signature, language }), container);
  return container;
}

describe('SignatureDisplay', () => {
  let container: HTMLElement;

  afterEach(() => {
    if (container?.parentNode) {
      render(null, container);
      container.parentNode.removeChild(container);
    }
  });

  it('renders signature text in <pre><code>', () => {
    container = renderComponent('function add(a: number, b: number): number', 'typescript');
    const pre = container.querySelector('pre.gh-lsp-popover__signature');
    expect(pre).not.toBeNull();
    const code = pre?.querySelector('code');
    expect(code?.textContent).toBe('function add(a: number, b: number): number');
  });

  it('sets language class on <code> element', () => {
    container = renderComponent('fn main()', 'rust');
    const code = container.querySelector('code');
    expect(code?.className).toBe('language-rust');
  });

  it('renders as text content (not HTML), preventing XSS', () => {
    container = renderComponent('<script>alert(1)</script>', 'typescript');
    const code = container.querySelector('code');
    // textContent should contain the literal string, not execute it
    expect(code?.textContent).toBe('<script>alert(1)</script>');
    // No actual script element should be created
    expect(container.querySelector('script')).toBeNull();
  });

  it('renders empty signature without error', () => {
    container = renderComponent('', 'typescript');
    const code = container.querySelector('code');
    expect(code).not.toBeNull();
    expect(code?.textContent).toBe('');
  });

  it('renders with different language classes', () => {
    container = renderComponent('def foo():', 'python');
    const code = container.querySelector('code');
    expect(code?.className).toBe('language-python');
  });
});
