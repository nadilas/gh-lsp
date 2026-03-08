import type { FunctionComponent } from 'preact';
import type { ParameterDisplayData } from '../../shared/types';

export interface ParameterListProps {
  /** List of parameters to display */
  parameters: ParameterDisplayData[];
}

export const ParameterList: FunctionComponent<ParameterListProps> = ({
  parameters,
}) => {
  if (parameters.length === 0) {
    return null;
  }

  return (
    <div class="gh-lsp-popover__parameters">
      {parameters.map((param) => (
        <div class="gh-lsp-popover__param" key={param.name}>
          <span class="gh-lsp-popover__param-name">{param.name}</span>
          <span class="gh-lsp-popover__param-type">: {param.type}</span>
          {param.defaultValue && (
            <span class="gh-lsp-popover__param-default">
              {' '}= {param.defaultValue}
            </span>
          )}
          {param.documentation && (
            <span class="gh-lsp-popover__param-doc">
              {' '}&mdash; {param.documentation}
            </span>
          )}
        </div>
      ))}
    </div>
  );
};
