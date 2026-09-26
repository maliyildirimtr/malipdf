/** Types for the parts of KaTeX the Formula tool uses (the package ships none). */
declare module 'katex' {
  interface KatexOptions {
    displayMode?: boolean;
    throwOnError?: boolean;
    output?: 'html' | 'mathml' | 'htmlAndMathml';
    strict?: boolean | 'ignore' | 'warn' | 'error';
    trust?: boolean;
    maxSize?: number;
    maxExpand?: number;
    macros?: Record<string, string>;
  }
  const katex: {
    renderToString(tex: string, options?: KatexOptions): string;
    render(tex: string, element: HTMLElement, options?: KatexOptions): void;
    ParseError: new (...args: unknown[]) => Error;
    version: string;
  };
  export default katex;
}
