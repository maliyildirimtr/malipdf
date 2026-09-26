export interface KatexOptions {
  displayMode?: boolean;
  throwOnError?: boolean;
  output?: 'html' | 'mathml' | 'htmlAndMathml';
  strict?: boolean | 'ignore' | 'warn' | 'error';
  trust?: boolean;
  maxSize?: number;
  maxExpand?: number;
}
declare const katex: {
  renderToString(tex: string, options?: KatexOptions): string;
  render(tex: string, element: HTMLElement, options?: KatexOptions): void;
  ParseError: new (...args: unknown[]) => Error;
  version: string;
};
export default katex;
