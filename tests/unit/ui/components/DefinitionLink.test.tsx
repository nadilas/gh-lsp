import { describe, it, expect, afterEach } from 'vitest';
import { h, render } from 'preact';
import {
  DefinitionLink,
  buildDefinitionUrl,
  type DefinitionLinkProps,
} from '../../../../src/ui/components/DefinitionLink';
import type { LspLocation } from '../../../../src/shared/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function renderComponent(props: DefinitionLinkProps): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  render(h(DefinitionLink, props), container);
  return container;
}

const defaultLocation: LspLocation = {
  uri: 'file:///src/utils/helpers.ts',
  range: {
    start: { line: 9, character: 0 },
    end: { line: 9, character: 30 },
  },
};

const repoContext = { owner: 'octocat', repo: 'hello-world', ref: 'main' };

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('buildDefinitionUrl', () => {
  it('returns web URLs as-is', () => {
    const location: LspLocation = {
      uri: 'https://github.com/octocat/hello-world/blob/main/src/index.ts#L5',
      range: { start: { line: 4, character: 0 }, end: { line: 4, character: 20 } },
    };
    expect(buildDefinitionUrl(location)).toBe(
      'https://github.com/octocat/hello-world/blob/main/src/index.ts#L5',
    );
  });

  it('returns http URLs as-is', () => {
    const location: LspLocation = {
      uri: 'http://example.com/file.ts',
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    };
    expect(buildDefinitionUrl(location)).toBe('http://example.com/file.ts');
  });

  it('constructs GitHub blob URL from file URI with repo context', () => {
    const url = buildDefinitionUrl(defaultLocation, repoContext);
    // line is 0-indexed (9), so GitHub line number is 10
    expect(url).toBe(
      'https://github.com/octocat/hello-world/blob/main/src/utils/helpers.ts#L10',
    );
  });

  it('handles file:// prefix (double slash)', () => {
    const location: LspLocation = {
      uri: 'file://src/app.ts',
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
    };
    const url = buildDefinitionUrl(location, repoContext);
    expect(url).toBe(
      'https://github.com/octocat/hello-world/blob/main/src/app.ts#L1',
    );
  });

  it('handles bare file path without file:// prefix', () => {
    const location: LspLocation = {
      uri: 'src/components/Button.tsx',
      range: { start: { line: 14, character: 0 }, end: { line: 14, character: 20 } },
    };
    const url = buildDefinitionUrl(location, repoContext);
    expect(url).toBe(
      'https://github.com/octocat/hello-world/blob/main/src/components/Button.tsx#L15',
    );
  });

  it('strips leading slash from file path', () => {
    const location: LspLocation = {
      uri: '/src/index.ts',
      range: { start: { line: 2, character: 0 }, end: { line: 2, character: 5 } },
    };
    const url = buildDefinitionUrl(location, repoContext);
    expect(url).toBe(
      'https://github.com/octocat/hello-world/blob/main/src/index.ts#L3',
    );
  });

  it('returns raw file path when no repo context', () => {
    const url = buildDefinitionUrl(defaultLocation);
    expect(url).toBe('src/utils/helpers.ts');
  });

  it('handles branch refs with slashes', () => {
    const ctx = { owner: 'octocat', repo: 'hello-world', ref: 'feature/my-branch' };
    const url = buildDefinitionUrl(defaultLocation, ctx);
    expect(url).toBe(
      'https://github.com/octocat/hello-world/blob/feature/my-branch/src/utils/helpers.ts#L10',
    );
  });

  it('handles SHA refs', () => {
    const ctx = { owner: 'octocat', repo: 'hello-world', ref: 'abc123def' };
    const url = buildDefinitionUrl(defaultLocation, ctx);
    expect(url).toBe(
      'https://github.com/octocat/hello-world/blob/abc123def/src/utils/helpers.ts#L10',
    );
  });
});

describe('DefinitionLink component', () => {
  let container: HTMLElement;

  afterEach(() => {
    if (container?.parentNode) {
      render(null, container);
      container.parentNode.removeChild(container);
    }
  });

  it('renders "Go to Definition" link', () => {
    container = renderComponent({
      location: defaultLocation,
      repoContext,
    });

    const link = container.querySelector('.gh-lsp-popover__definition-link') as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.textContent).toBe('Go to Definition');
  });

  it('opens link in new tab', () => {
    container = renderComponent({
      location: defaultLocation,
      repoContext,
    });

    const link = container.querySelector('.gh-lsp-popover__definition-link') as HTMLAnchorElement;
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
  });

  it('has aria-label for accessibility', () => {
    container = renderComponent({
      location: defaultLocation,
      repoContext,
    });

    const link = container.querySelector('.gh-lsp-popover__definition-link');
    expect(link?.getAttribute('aria-label')).toBe('Go to definition');
  });

  it('constructs correct GitHub URL with repo context', () => {
    container = renderComponent({
      location: defaultLocation,
      repoContext,
    });

    const link = container.querySelector('.gh-lsp-popover__definition-link') as HTMLAnchorElement;
    expect(link.href).toContain(
      'https://github.com/octocat/hello-world/blob/main/src/utils/helpers.ts#L10',
    );
  });

  it('renders declaration source when provided', () => {
    container = renderComponent({
      location: defaultLocation,
      declarationSource: 'src/utils/helpers.ts',
      repoContext,
    });

    const source = container.querySelector('.gh-lsp-popover__declaration-source');
    expect(source).not.toBeNull();
    expect(source?.textContent).toContain('in');
    expect(source?.textContent).toContain('src/utils/helpers.ts');
  });

  it('does not render declaration source when not provided', () => {
    container = renderComponent({
      location: defaultLocation,
      repoContext,
    });

    const source = container.querySelector('.gh-lsp-popover__declaration-source');
    expect(source).toBeNull();
  });

  it('uses web URL directly when URI is already a web URL', () => {
    const webLocation: LspLocation = {
      uri: 'https://github.com/owner/repo/blob/main/file.ts#L5',
      range: { start: { line: 4, character: 0 }, end: { line: 4, character: 10 } },
    };
    container = renderComponent({ location: webLocation });

    const link = container.querySelector('.gh-lsp-popover__definition-link') as HTMLAnchorElement;
    expect(link.href).toBe('https://github.com/owner/repo/blob/main/file.ts#L5');
  });
});
