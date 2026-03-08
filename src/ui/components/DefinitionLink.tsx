import type { FunctionComponent } from 'preact';
import type { LspLocation } from '../../shared/types';

export interface DefinitionLinkProps {
  /** The LSP location of the definition */
  location: LspLocation;
  /** Display text for the file source (e.g. "src/greet.ts") */
  declarationSource?: string;
  /** Optional repo context to construct GitHub blob URLs from file URIs */
  repoContext?: {
    owner: string;
    repo: string;
    ref: string;
  };
}

/**
 * Constructs a GitHub blob URL from a file path and repo context.
 * If the URI is already a web URL, returns it as-is.
 * If repoContext is provided and URI is a file path, constructs a GitHub URL.
 */
export function buildDefinitionUrl(
  location: LspLocation,
  repoContext?: DefinitionLinkProps['repoContext'],
): string {
  const { uri, range } = location;

  // If already a web URL, use directly
  if (uri.startsWith('https://') || uri.startsWith('http://')) {
    return uri;
  }

  // Extract file path from URI (strip file:// prefix if present)
  let filePath = uri;
  if (filePath.startsWith('file:///')) {
    filePath = filePath.slice(7); // remove 'file:///'
  } else if (filePath.startsWith('file://')) {
    filePath = filePath.slice(6); // remove 'file://'
  }

  // Remove leading slash if present
  if (filePath.startsWith('/')) {
    filePath = filePath.slice(1);
  }

  if (repoContext) {
    const { owner, repo, ref } = repoContext;
    // LSP lines are 0-indexed, GitHub uses 1-indexed
    const lineNumber = range.start.line + 1;
    return `https://github.com/${owner}/${repo}/blob/${ref}/${filePath}#L${lineNumber}`;
  }

  // No repo context — return the raw file path as a best-effort link
  return filePath;
}

export const DefinitionLink: FunctionComponent<DefinitionLinkProps> = ({
  location,
  declarationSource,
  repoContext,
}) => {
  const href = buildDefinitionUrl(location, repoContext);

  return (
    <div class="gh-lsp-popover__definition">
      <a
        class="gh-lsp-popover__definition-link"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Go to definition"
      >
        Go to Definition
      </a>
      {declarationSource && (
        <span class="gh-lsp-popover__declaration-source">
          {' '}in {declarationSource}
        </span>
      )}
    </div>
  );
};
