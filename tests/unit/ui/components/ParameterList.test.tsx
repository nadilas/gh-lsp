import { describe, it, expect, afterEach } from 'vitest';
import { h, render } from 'preact';
import { ParameterList } from '../../../../src/ui/components/ParameterList';
import type { ParameterDisplayData } from '../../../../src/shared/types';

function renderComponent(parameters: ParameterDisplayData[]): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  render(h(ParameterList, { parameters }), container);
  return container;
}

describe('ParameterList', () => {
  let container: HTMLElement;

  afterEach(() => {
    if (container?.parentNode) {
      render(null, container);
      container.parentNode.removeChild(container);
    }
  });

  it('returns null for empty parameter list', () => {
    container = renderComponent([]);
    expect(container.querySelector('.gh-lsp-popover__parameters')).toBeNull();
  });

  it('renders parameter name and type', () => {
    container = renderComponent([
      { name: 'count', type: 'number' },
    ]);

    const nameEl = container.querySelector('.gh-lsp-popover__param-name');
    const typeEl = container.querySelector('.gh-lsp-popover__param-type');
    expect(nameEl?.textContent).toBe('count');
    expect(typeEl?.textContent).toContain('number');
  });

  it('renders default value when provided', () => {
    container = renderComponent([
      { name: 'limit', type: 'number', defaultValue: '10' },
    ]);

    const defaultEl = container.querySelector('.gh-lsp-popover__param-default');
    expect(defaultEl).not.toBeNull();
    expect(defaultEl?.textContent).toContain('10');
  });

  it('omits default value span when not provided', () => {
    container = renderComponent([
      { name: 'id', type: 'string' },
    ]);

    const defaultEl = container.querySelector('.gh-lsp-popover__param-default');
    expect(defaultEl).toBeNull();
  });

  it('renders documentation when provided', () => {
    container = renderComponent([
      { name: 'name', type: 'string', documentation: 'The user name' },
    ]);

    const docEl = container.querySelector('.gh-lsp-popover__param-doc');
    expect(docEl).not.toBeNull();
    expect(docEl?.textContent).toContain('The user name');
  });

  it('omits documentation span when not provided', () => {
    container = renderComponent([
      { name: 'id', type: 'number' },
    ]);

    const docEl = container.querySelector('.gh-lsp-popover__param-doc');
    expect(docEl).toBeNull();
  });

  it('renders multiple parameters', () => {
    container = renderComponent([
      { name: 'a', type: 'string' },
      { name: 'b', type: 'number' },
      { name: 'c', type: 'boolean' },
    ]);

    const params = container.querySelectorAll('.gh-lsp-popover__param');
    expect(params.length).toBe(3);
  });
});
