import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  findCodeContainers,
  findCodeLines,
  isCodeLine,
  isCodeContainer,
  observeCodeDom,
  type DomObserverCallbacks,
} from '../../../src/content/dom-observer';

// Helper to flush microtasks + MutationObserver callbacks
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('findCodeContainers', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('finds react code line containers', () => {
    document.body.innerHTML = '<div class="react-code-lines"></div>';
    expect(findCodeContainers()).toHaveLength(1);
  });

  it('finds legacy table highlight containers', () => {
    document.body.innerHTML = '<table class="highlight tab-size"></table>';
    expect(findCodeContainers()).toHaveLength(1);
  });

  it('finds diff progressive containers', () => {
    document.body.innerHTML = '<div class="js-diff-progressive-container"></div>';
    expect(findCodeContainers()).toHaveLength(1);
  });

  it('finds diff file content containers', () => {
    document.body.innerHTML = '<div class="js-file-content"></div>';
    expect(findCodeContainers()).toHaveLength(1);
  });

  it('finds multiple containers', () => {
    document.body.innerHTML = `
      <div class="react-code-lines"></div>
      <div class="js-file-content"></div>
      <div class="js-diff-progressive-container"></div>
    `;
    expect(findCodeContainers()).toHaveLength(3);
  });

  it('returns empty array when no containers exist', () => {
    document.body.innerHTML = '<div class="unrelated"></div>';
    expect(findCodeContainers()).toHaveLength(0);
  });
});

describe('findCodeLines', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('finds react line rows', () => {
    document.body.innerHTML = `
      <div class="react-code-lines">
        <div class="react-line-row">line 1</div>
        <div class="react-line-row">line 2</div>
      </div>
    `;
    const container = document.querySelector('.react-code-lines')!;
    expect(findCodeLines(container)).toHaveLength(2);
  });

  it('finds blob-code elements', () => {
    document.body.innerHTML = `
      <table class="highlight">
        <tr class="blob-code">line 1</tr>
        <tr class="blob-code">line 2</tr>
        <tr class="blob-code">line 3</tr>
      </table>
    `;
    const container = document.querySelector('table.highlight')!;
    expect(findCodeLines(container)).toHaveLength(3);
  });

  it('returns empty array for container with no lines', () => {
    document.body.innerHTML = '<div class="react-code-lines"><div>not a line</div></div>';
    const container = document.querySelector('.react-code-lines')!;
    expect(findCodeLines(container)).toHaveLength(0);
  });
});

describe('isCodeLine', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('returns true for react-line-row', () => {
    document.body.innerHTML = '<div class="react-line-row"></div>';
    const el = document.querySelector('.react-line-row')!;
    expect(isCodeLine(el)).toBe(true);
  });

  it('returns true for blob-code', () => {
    document.body.innerHTML = '<table><tbody><tr class="blob-code"></tr></tbody></table>';
    const el = document.querySelector('.blob-code')!;
    expect(isCodeLine(el)).toBe(true);
  });

  it('returns false for non-code elements', () => {
    document.body.innerHTML = '<div class="other"></div>';
    const el = document.querySelector('.other')!;
    expect(isCodeLine(el)).toBe(false);
  });
});

describe('isCodeContainer', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('returns true for react-code-lines', () => {
    document.body.innerHTML = '<div class="react-code-lines"></div>';
    const el = document.querySelector('.react-code-lines')!;
    expect(isCodeContainer(el)).toBe(true);
  });

  it('returns true for js-file-content', () => {
    document.body.innerHTML = '<div class="js-file-content"></div>';
    const el = document.querySelector('.js-file-content')!;
    expect(isCodeContainer(el)).toBe(true);
  });

  it('returns false for non-container elements', () => {
    document.body.innerHTML = '<div class="unrelated"></div>';
    const el = document.querySelector('.unrelated')!;
    expect(isCodeContainer(el)).toBe(false);
  });
});

describe('observeCodeDom', () => {
  let callbacks: DomObserverCallbacks;
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    document.body.innerHTML = '';
    callbacks = {
      onLinesAdded: vi.fn(),
      onLinesRemoved: vi.fn(),
      onCodeContainerAdded: vi.fn(),
    };
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it('detects added code lines', async () => {
    cleanup = observeCodeDom(callbacks);

    const line = document.createElement('div');
    line.className = 'react-line-row';
    document.body.appendChild(line);

    await flush();

    expect(callbacks.onLinesAdded).toHaveBeenCalledWith([line]);
  });

  it('detects removed code lines', async () => {
    const line = document.createElement('div');
    line.className = 'react-line-row';
    document.body.appendChild(line);

    cleanup = observeCodeDom(callbacks);

    document.body.removeChild(line);

    await flush();

    expect(callbacks.onLinesRemoved).toHaveBeenCalledWith([line]);
  });

  it('detects added code containers', async () => {
    cleanup = observeCodeDom(callbacks);

    const container = document.createElement('div');
    container.className = 'react-code-lines';
    document.body.appendChild(container);

    await flush();

    expect(callbacks.onCodeContainerAdded).toHaveBeenCalledWith(container);
  });

  it('detects lines within added containers', async () => {
    cleanup = observeCodeDom(callbacks);

    const container = document.createElement('div');
    container.className = 'react-code-lines';
    const line1 = document.createElement('div');
    line1.className = 'react-line-row';
    const line2 = document.createElement('div');
    line2.className = 'react-line-row';
    container.appendChild(line1);
    container.appendChild(line2);

    document.body.appendChild(container);

    await flush();

    expect(callbacks.onLinesAdded).toHaveBeenCalledWith([line1, line2]);
  });

  it('detects nested code containers', async () => {
    cleanup = observeCodeDom(callbacks);

    const wrapper = document.createElement('div');
    const container = document.createElement('div');
    container.className = 'js-file-content';
    wrapper.appendChild(container);

    document.body.appendChild(wrapper);

    await flush();

    expect(callbacks.onCodeContainerAdded).toHaveBeenCalledWith(container);
  });

  it('detects nested code lines', async () => {
    cleanup = observeCodeDom(callbacks);

    const wrapper = document.createElement('div');
    const line = document.createElement('div');
    line.className = 'react-line-row';
    wrapper.appendChild(line);

    document.body.appendChild(wrapper);

    await flush();

    expect(callbacks.onLinesAdded).toHaveBeenCalledWith([line]);
  });

  it('does not fire callbacks for non-code elements', async () => {
    cleanup = observeCodeDom(callbacks);

    const div = document.createElement('div');
    div.className = 'unrelated';
    document.body.appendChild(div);

    await flush();

    expect(callbacks.onLinesAdded).not.toHaveBeenCalled();
    expect(callbacks.onLinesRemoved).not.toHaveBeenCalled();
    expect(callbacks.onCodeContainerAdded).not.toHaveBeenCalled();
  });

  it('stops observing after cleanup', async () => {
    cleanup = observeCodeDom(callbacks);
    cleanup();
    cleanup = undefined;

    const line = document.createElement('div');
    line.className = 'react-line-row';
    document.body.appendChild(line);

    await flush();

    expect(callbacks.onLinesAdded).not.toHaveBeenCalled();
  });

  it('handles removed containers by reporting their lines', async () => {
    const container = document.createElement('div');
    container.className = 'react-code-lines';
    const line = document.createElement('div');
    line.className = 'react-line-row';
    container.appendChild(line);
    document.body.appendChild(container);

    cleanup = observeCodeDom(callbacks);

    document.body.removeChild(container);

    await flush();

    expect(callbacks.onLinesRemoved).toHaveBeenCalledWith([line]);
  });

  it('handles multiple simultaneous additions', async () => {
    cleanup = observeCodeDom(callbacks);

    const fragment = document.createDocumentFragment();
    const line1 = document.createElement('div');
    line1.className = 'react-line-row';
    const line2 = document.createElement('div');
    line2.className = 'react-line-row';
    fragment.appendChild(line1);
    fragment.appendChild(line2);

    document.body.appendChild(fragment);

    await flush();

    expect(callbacks.onLinesAdded).toHaveBeenCalledWith([line1, line2]);
  });
});
