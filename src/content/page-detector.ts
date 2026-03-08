import type { GitHubViewType, RepoContext } from '../shared/types';
import { getLanguageForFilePath } from '../shared/languages';

/**
 * Result of detecting the current GitHub page. Null when the page
 * is not a supported code view (blob, PR files, compare).
 */
export interface PageDetectionResult {
  viewType: GitHubViewType;
  context: RepoContext;
}

// ─── URL Pattern Matching ───────────────────────────────────────────────────

/**
 * Regex for single-file blob views:
 * /{owner}/{repo}/blob/{ref}/{...filePath}
 *
 * Captures: owner, repo, ref, filePath
 * The ref can be a branch name, tag, or SHA (may contain slashes for nested branches).
 * We use a non-greedy match for ref and rely on the file extension to disambiguate.
 */
const BLOB_PATTERN =
  /^\/([^/]+)\/([^/]+)\/blob\/([^/]+(?:\/[^/]+)*?)\/(.+)$/;

/**
 * Regex for pull request file views:
 * /{owner}/{repo}/pull/{number}/files
 *
 * Captures: owner, repo, pullNumber
 */
const PR_FILES_PATTERN =
  /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/files/;

/**
 * Regex for compare views:
 * /{owner}/{repo}/compare/{base}...{head}
 *
 * Captures: owner, repo, compareSpec (base...head)
 */
const COMPARE_PATTERN =
  /^\/([^/]+)\/([^/]+)\/compare\/(.+)/;

/**
 * Detects the current GitHub page type and extracts repository context
 * from the URL. Returns null if the page is not a supported code view.
 */
export function detectPage(url: string): PageDetectionResult | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }

  return detectBlobPage(pathname)
    ?? detectPrFilesPage(pathname)
    ?? detectComparePage(pathname);
}

/**
 * Detects a single-file blob view and extracts repo context.
 */
function detectBlobPage(pathname: string): PageDetectionResult | null {
  const match = BLOB_PATTERN.exec(pathname);
  if (!match || !match[1] || !match[2] || !match[3] || !match[4]) return null;

  const owner = match[1];
  const repo = match[2];
  const ref = match[3];
  const filePath = match[4];
  const language = getLanguageForFilePath(filePath) ?? '';

  return {
    viewType: 'blob',
    context: { owner, repo, ref, filePath, language },
  };
}

/**
 * Detects a PR files view. The repo context is partial (no single filePath/ref)
 * because PR file views contain many files. We return a placeholder context
 * with the PR number as ref so downstream code can fetch PR details.
 */
function detectPrFilesPage(pathname: string): PageDetectionResult | null {
  const match = PR_FILES_PATTERN.exec(pathname);
  if (!match || !match[1] || !match[2] || !match[3]) return null;

  const owner = match[1];
  const repo = match[2];
  const pullNumber = match[3];

  return {
    viewType: 'pull-request-files',
    context: {
      owner,
      repo,
      ref: `pull/${pullNumber}`,
      filePath: '',
      language: '',
    },
  };
}

/**
 * Detects a compare view. Similar to PR files, there's no single file —
 * the compare spec is stored as ref.
 */
function detectComparePage(pathname: string): PageDetectionResult | null {
  const match = COMPARE_PATTERN.exec(pathname);
  if (!match || !match[1] || !match[2] || !match[3]) return null;

  const owner = match[1];
  const repo = match[2];
  const compareSpec = match[3];

  return {
    viewType: 'compare',
    context: {
      owner,
      repo,
      ref: compareSpec,
      filePath: '',
      language: '',
    },
  };
}

// ─── Ref Disambiguation for Blob URLs ────────────────────────────────────────

/**
 * GitHub blob URLs with multi-segment branch names (e.g. `feat/foo/bar`)
 * are ambiguous: `/owner/repo/blob/feat/foo/bar/src/index.ts` could mean
 * ref=`feat/foo/bar` path=`src/index.ts` or ref=`feat/foo` path=`bar/src/index.ts`.
 *
 * This function attempts to disambiguate by checking the DOM for the branch
 * selector element which GitHub renders with the actual ref name.
 *
 * Falls back to the regex-parsed ref if no DOM element is found.
 */
export function extractRefFromDom(): string | null {
  // GitHub renders the current ref in a span or a details-menu
  // inside the branch selector. The most reliable selector is the
  // `data-ref` attribute on the branch picker's hidden input.
  const refInput = document.querySelector<HTMLInputElement>(
    'input[name="ref"], #ref-selector input[data-ref]',
  );
  if (refInput) {
    return refInput.getAttribute('data-ref') ?? refInput.value ?? null;
  }

  // Fallback: the branch/tag selector button often has a span with the ref text
  const refSpan = document.querySelector<HTMLElement>(
    '[data-hotkey="w"] span.css-truncate-target, .branch-select-menu .css-truncate-target',
  );
  if (refSpan?.textContent) {
    return refSpan.textContent.trim();
  }

  return null;
}

/**
 * Refines a blob detection result using DOM-based ref extraction.
 * If the DOM provides a more accurate ref, the filePath is adjusted
 * accordingly (the ref prefix is stripped from the path).
 */
export function refineBlobContext(
  result: PageDetectionResult,
  pathname: string,
): PageDetectionResult {
  if (result.viewType !== 'blob') return result;

  const domRef = extractRefFromDom();
  if (!domRef) return result;

  // Re-extract filePath relative to the correct ref
  // pathname format: /{owner}/{repo}/blob/{ref...}/{filePath...}
  const blobIndex = pathname.indexOf('/blob/');
  if (blobIndex < 0) return result;

  const afterBlob = pathname.slice(blobIndex + '/blob/'.length);
  if (!afterBlob.startsWith(domRef)) return result;

  const filePath = afterBlob.slice(domRef.length + 1); // +1 for the slash
  if (!filePath) return result;

  const language = getLanguageForFilePath(filePath) ?? '';

  return {
    viewType: 'blob',
    context: {
      ...result.context,
      ref: domRef,
      filePath,
      language,
    },
  };
}

// ─── Turbo Navigation Detection ──────────────────────────────────────────────

export type NavigationCallback = (url: string) => void;

/**
 * Sets up listeners for GitHub's Turbo-powered client-side navigation.
 * GitHub uses Turbo (formerly Turbolinks/pjax) for SPA-like page transitions
 * without full page reloads.
 *
 * Returns a cleanup function that removes the listeners.
 */
export function observeNavigation(callback: NavigationCallback): () => void {
  // Turbo fires 'turbo:load' after navigation completes
  const handleTurboLoad = () => {
    callback(window.location.href);
  };

  // Also listen for popstate (browser back/forward)
  const handlePopState = () => {
    callback(window.location.href);
  };

  // GitHub's legacy pjax events (older GitHub pages)
  const handlePjaxEnd = () => {
    callback(window.location.href);
  };

  document.addEventListener('turbo:load', handleTurboLoad);
  window.addEventListener('popstate', handlePopState);
  document.addEventListener('pjax:end', handlePjaxEnd);

  return () => {
    document.removeEventListener('turbo:load', handleTurboLoad);
    window.removeEventListener('popstate', handlePopState);
    document.removeEventListener('pjax:end', handlePjaxEnd);
  };
}
