import { describe, expect, it } from 'vitest';
import { cleanEditorLatex, toEditorTemplate } from '../formulaCatalog';

describe('visual editor templates', () => {
  it('turns the parts to fill in into boxes, the first taking the selection', () => {
    expect(toEditorTemplate('\\frac{a}{b}')).toBe('\\frac{#@}{#?}');
    expect(toEditorTemplate('\\sqrt[n]{x}')).toBe('\\sqrt[n]{#@}');
    expect(toEditorTemplate('\\left( x \\right)')).toBe('\\left( #@ \\right)');
    expect(toEditorTemplate('\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}')).toBe('\\begin{pmatrix} #@ & #? \\\\ #? & #? \\end{pmatrix}');
    expect(toEditorTemplate('\\sum_{i=1}^{n} x_{i}')).toBe('\\sum_{i=1}^{#@} x_{#?}');
    expect(toEditorTemplate('\\overset{\\text{def}}{=}')).toBe('\\overset{\\text{def}}{=}');
  });

  it('removes empty boxes before typesetting', () => {
    expect(cleanEditorLatex('\\frac{\\placeholder{}}{2}')).toBe('\\frac{}{2}');
    expect(cleanEditorLatex('x+\\placeholder[a]{}')).toBe('x+');
  });
});
