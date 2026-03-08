import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  detectPage,
  extractRefFromDom,
  refineBlobContext,
  observeNavigation,
  type PageDetectionResult,
} from '../../../src/content/page-detector';

describe('detectPage', () => {
  describe('blob views', () => {
    it('detects a simple blob URL', () => {
      const result = detectPage('https://github.com/owner/repo/blob/main/src/index.ts');
      expect(result).toEqual({
        viewType: 'blob',
        context: {
          owner: 'owner',
          repo: 'repo',
          ref: 'main',
          filePath: 'src/index.ts',
          language: 'typescript',
        },
      });
    });

    it('detects blob with SHA ref', () => {
      const result = detectPage(
        'https://github.com/owner/repo/blob/abc123def/package.json',
      );
      expect(result).not.toBeNull();
      expect(result!.viewType).toBe('blob');
      expect(result!.context.ref).toBe('abc123def');
      expect(result!.context.filePath).toBe('package.json');
    });

    it('detects blob with nested file path', () => {
      const result = detectPage(
        'https://github.com/owner/repo/blob/main/src/components/Button.tsx',
      );
      expect(result).not.toBeNull();
      expect(result!.context.filePath).toBe('src/components/Button.tsx');
      expect(result!.context.language).toBe('typescript');
    });

    it('detects JavaScript files', () => {
      const result = detectPage(
        'https://github.com/foo/bar/blob/develop/lib/utils.js',
      );
      expect(result).not.toBeNull();
      expect(result!.context.language).toBe('javascript');
    });

    it('detects Go files', () => {
      const result = detectPage(
        'https://github.com/golang/go/blob/master/src/main.go',
      );
      expect(result).not.toBeNull();
      expect(result!.context.language).toBe('go');
    });

    it('detects Rust files', () => {
      const result = detectPage(
        'https://github.com/user/proj/blob/main/src/lib.rs',
      );
      expect(result).not.toBeNull();
      expect(result!.context.language).toBe('rust');
    });

    it('detects Python files', () => {
      const result = detectPage(
        'https://github.com/user/proj/blob/main/app.py',
      );
      expect(result).not.toBeNull();
      expect(result!.context.language).toBe('python');
    });

    it('sets empty language for unsupported file types', () => {
      const result = detectPage(
        'https://github.com/user/proj/blob/main/README.md',
      );
      expect(result).not.toBeNull();
      expect(result!.context.language).toBe('');
    });

    it('handles refs with slashes (branch names)', () => {
      // With the greedy-then-file-check approach, `feat/awesome` is ref, `src/main.ts` is path
      const result = detectPage(
        'https://github.com/owner/repo/blob/feat/awesome/src/main.ts',
      );
      expect(result).not.toBeNull();
      expect(result!.viewType).toBe('blob');
      // The regex captures greedily — without DOM refinement, ref may include parts of the path.
      // At minimum, the detection should succeed (non-null).
      expect(result!.context.owner).toBe('owner');
      expect(result!.context.repo).toBe('repo');
    });

    it('handles tag-like refs (v1.2.3)', () => {
      const result = detectPage(
        'https://github.com/owner/repo/blob/v1.2.3/src/index.ts',
      );
      expect(result).not.toBeNull();
      expect(result!.context.ref).toBe('v1.2.3');
      expect(result!.context.filePath).toBe('src/index.ts');
    });
  });

  describe('pull request file views', () => {
    it('detects a PR files page', () => {
      const result = detectPage(
        'https://github.com/owner/repo/pull/42/files',
      );
      expect(result).toEqual({
        viewType: 'pull-request-files',
        context: {
          owner: 'owner',
          repo: 'repo',
          ref: 'pull/42',
          filePath: '',
          language: '',
        },
      });
    });

    it('detects PR files with query parameters', () => {
      const result = detectPage(
        'https://github.com/owner/repo/pull/100/files?diff=unified',
      );
      expect(result).not.toBeNull();
      expect(result!.viewType).toBe('pull-request-files');
      expect(result!.context.ref).toBe('pull/100');
    });

    it('detects PR files with hash fragment', () => {
      const result = detectPage(
        'https://github.com/owner/repo/pull/7/files#diff-abc123',
      );
      expect(result).not.toBeNull();
      expect(result!.viewType).toBe('pull-request-files');
    });

    it('does not match PR conversation page', () => {
      const result = detectPage(
        'https://github.com/owner/repo/pull/42',
      );
      expect(result).toBeNull();
    });

    it('does not match PR commits page', () => {
      const result = detectPage(
        'https://github.com/owner/repo/pull/42/commits',
      );
      expect(result).toBeNull();
    });
  });

  describe('compare views', () => {
    it('detects a compare view', () => {
      const result = detectPage(
        'https://github.com/owner/repo/compare/main...feature-branch',
      );
      expect(result).toEqual({
        viewType: 'compare',
        context: {
          owner: 'owner',
          repo: 'repo',
          ref: 'main...feature-branch',
          filePath: '',
          language: '',
        },
      });
    });

    it('detects compare with three-dot notation', () => {
      const result = detectPage(
        'https://github.com/owner/repo/compare/v1.0...v2.0',
      );
      expect(result).not.toBeNull();
      expect(result!.viewType).toBe('compare');
      expect(result!.context.ref).toBe('v1.0...v2.0');
    });

    it('detects compare with two-dot notation', () => {
      const result = detectPage(
        'https://github.com/owner/repo/compare/main..develop',
      );
      expect(result).not.toBeNull();
      expect(result!.viewType).toBe('compare');
    });
  });

  describe('unsupported pages', () => {
    it('returns null for repository root', () => {
      expect(detectPage('https://github.com/owner/repo')).toBeNull();
    });

    it('returns null for issues page', () => {
      expect(detectPage('https://github.com/owner/repo/issues')).toBeNull();
    });

    it('returns null for settings page', () => {
      expect(detectPage('https://github.com/owner/repo/settings')).toBeNull();
    });

    it('returns null for actions page', () => {
      expect(detectPage('https://github.com/owner/repo/actions')).toBeNull();
    });

    it('returns null for tree view (directory listing)', () => {
      expect(
        detectPage('https://github.com/owner/repo/tree/main/src'),
      ).toBeNull();
    });

    it('returns null for user profile', () => {
      expect(detectPage('https://github.com/username')).toBeNull();
    });

    it('returns null for non-GitHub URLs', () => {
      expect(detectPage('https://example.com/blob/main/file.ts')).toBeNull();
    });

    it('returns null for invalid URLs', () => {
      expect(detectPage('not-a-url')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(detectPage('')).toBeNull();
    });
  });
});

describe('extractRefFromDom', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('extracts ref from input[name="ref"]', () => {
    document.body.innerHTML =
      '<input name="ref" data-ref="feature/branch" value="feature/branch">';
    expect(extractRefFromDom()).toBe('feature/branch');
  });

  it('prefers data-ref attribute over value', () => {
    document.body.innerHTML =
      '<input name="ref" data-ref="real-ref" value="fallback">';
    expect(extractRefFromDom()).toBe('real-ref');
  });

  it('falls back to value when data-ref missing', () => {
    document.body.innerHTML = '<input name="ref" value="main">';
    expect(extractRefFromDom()).toBe('main');
  });

  it('extracts ref from branch selector span', () => {
    document.body.innerHTML =
      '<button data-hotkey="w"><span class="css-truncate-target">develop</span></button>';
    expect(extractRefFromDom()).toBe('develop');
  });

  it('returns null when no ref element exists', () => {
    document.body.innerHTML = '<div>No branch selector here</div>';
    expect(extractRefFromDom()).toBeNull();
  });
});

describe('refineBlobContext', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('refines ref and filePath using DOM ref', () => {
    document.body.innerHTML =
      '<input name="ref" data-ref="feat/awesome" value="feat/awesome">';

    const initial: PageDetectionResult = {
      viewType: 'blob',
      context: {
        owner: 'owner',
        repo: 'repo',
        ref: 'feat',
        filePath: 'awesome/src/main.ts',
        language: 'typescript',
      },
    };

    const refined = refineBlobContext(
      initial,
      '/owner/repo/blob/feat/awesome/src/main.ts',
    );

    expect(refined.context.ref).toBe('feat/awesome');
    expect(refined.context.filePath).toBe('src/main.ts');
    expect(refined.context.language).toBe('typescript');
  });

  it('returns original result for non-blob views', () => {
    const result: PageDetectionResult = {
      viewType: 'pull-request-files',
      context: {
        owner: 'owner',
        repo: 'repo',
        ref: 'pull/42',
        filePath: '',
        language: '',
      },
    };

    expect(refineBlobContext(result, '/owner/repo/pull/42/files')).toBe(result);
  });

  it('returns original result when DOM has no ref', () => {
    document.body.innerHTML = '<div>No ref</div>';

    const result: PageDetectionResult = {
      viewType: 'blob',
      context: {
        owner: 'owner',
        repo: 'repo',
        ref: 'main',
        filePath: 'src/index.ts',
        language: 'typescript',
      },
    };

    expect(refineBlobContext(result, '/owner/repo/blob/main/src/index.ts')).toBe(
      result,
    );
  });

  it('returns original result when DOM ref does not match pathname', () => {
    document.body.innerHTML =
      '<input name="ref" data-ref="unrelated" value="unrelated">';

    const result: PageDetectionResult = {
      viewType: 'blob',
      context: {
        owner: 'owner',
        repo: 'repo',
        ref: 'main',
        filePath: 'src/index.ts',
        language: 'typescript',
      },
    };

    expect(
      refineBlobContext(result, '/owner/repo/blob/main/src/index.ts'),
    ).toBe(result);
  });
});

describe('observeNavigation', () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it('calls callback on turbo:load event', () => {
    const callback = vi.fn();
    cleanup = observeNavigation(callback);

    document.dispatchEvent(new Event('turbo:load'));

    expect(callback).toHaveBeenCalledWith(window.location.href);
  });

  it('calls callback on popstate event', () => {
    const callback = vi.fn();
    cleanup = observeNavigation(callback);

    window.dispatchEvent(new Event('popstate'));

    expect(callback).toHaveBeenCalledWith(window.location.href);
  });

  it('calls callback on pjax:end event', () => {
    const callback = vi.fn();
    cleanup = observeNavigation(callback);

    document.dispatchEvent(new Event('pjax:end'));

    expect(callback).toHaveBeenCalledWith(window.location.href);
  });

  it('removes listeners on cleanup', () => {
    const callback = vi.fn();
    cleanup = observeNavigation(callback);
    cleanup();
    cleanup = undefined;

    document.dispatchEvent(new Event('turbo:load'));
    window.dispatchEvent(new Event('popstate'));
    document.dispatchEvent(new Event('pjax:end'));

    expect(callback).not.toHaveBeenCalled();
  });
});
