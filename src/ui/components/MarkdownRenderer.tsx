import { type FunctionComponent } from 'preact';
import { useMemo } from 'preact/hooks';
import { marked, type MarkedOptions } from 'marked';
import DOMPurify from 'dompurify';

export interface MarkdownRendererProps {
  /** Raw markdown content to render */
  content: string;
  /** Optional CSS class for the container */
  className?: string;
}

// Configure marked for safe, minimal synchronous output
const markedOptions: MarkedOptions = {
  gfm: true,
  breaks: false,
  async: false,
};

export const MarkdownRenderer: FunctionComponent<MarkdownRendererProps> = ({
  content,
  className,
}) => {
  const sanitizedHtml = useMemo(() => {
    const rawHtml = marked.parse(content, markedOptions) as string;
    return DOMPurify.sanitize(rawHtml, {
      ALLOWED_TAGS: [
        'p',
        'br',
        'strong',
        'em',
        'code',
        'pre',
        'a',
        'ul',
        'ol',
        'li',
        'blockquote',
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'hr',
        'del',
        'table',
        'thead',
        'tbody',
        'tr',
        'th',
        'td',
      ],
      ALLOWED_ATTR: ['href', 'target', 'rel', 'class'],
    });
  }, [content]);

  return (
    <div
      class={
        className
          ? `gh-lsp-popover__documentation ${className}`
          : 'gh-lsp-popover__documentation'
      }
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
    />
  );
};
