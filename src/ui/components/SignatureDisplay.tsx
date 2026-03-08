import type { FunctionComponent } from 'preact';
import type { SupportedLanguage } from '../../shared/types';

export interface SignatureDisplayProps {
  /** The type/function signature text */
  signature: string;
  /** The language for syntax highlighting hints */
  language: SupportedLanguage;
}

export const SignatureDisplay: FunctionComponent<SignatureDisplayProps> = ({
  signature,
  language,
}) => (
  <pre class="gh-lsp-popover__signature">
    <code class={`language-${language}`}>{signature}</code>
  </pre>
);
