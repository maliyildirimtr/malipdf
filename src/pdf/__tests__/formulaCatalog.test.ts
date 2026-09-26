import { describe, expect, it } from 'vitest';
import katex from 'katex';
import { STRUCTURES, SYMBOL_GROUPS, firstPlaceholder, insertStructure } from '../formulaCatalog';

describe('formula catalog', () => {
  const all = [
    ...SYMBOL_GROUPS.flatMap((g) => g.items),
    ...STRUCTURES.flatMap((st) => [{ latex: st.icon, title: st.label }, ...st.sections.flatMap((sec) => sec.items)]),
  ];

  it('every symbol and template typesets with KaTeX', () => {
    const failed: string[] = [];
    for (const item of all) {
      try {
        katex.renderToString(item.latex, { throwOnError: true, strict: 'ignore' });
      } catch (error) {
        failed.push(`${item.title}: ${item.latex} — ${(error as Error).message}`);
      }
    }
    expect(failed).toEqual([]);
  });

  it('finds the first placeholder, skipping environment names', () => {
    expect(firstPlaceholder('\\frac{a}{b}')).toEqual({ start: 6, end: 7 });
    const m = '\\begin{pmatrix} a & b \\end{pmatrix}';
    expect(firstPlaceholder(m)).toBeNull();
  });

  it('inserts at the cursor and selects the first part to fill in', () => {
    const r = insertStructure('y = ', 4, 4, '\\frac{a}{b}');
    expect(r.text).toBe('y = \\frac{a}{b}');
    expect(r.text.slice(r.selStart, r.selEnd)).toBe('a');
  });

  it('wraps the selection into the first part', () => {
    const r = insertStructure('x+1', 0, 3, '\\sqrt{x}');
    expect(r.text).toBe('\\sqrt{x+1}');
    expect(r.selStart).toBe(r.text.length);
  });

  it('adds a space after a command when letters follow', () => {
    expect(insertStructure('x', 0, 0, '\\alpha').text).toBe('\\alpha x');
  });
});
