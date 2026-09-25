import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { autoSizeTextBox, layoutTextLines, LINE_HEIGHT, MAX_AUTO_TEXT_WIDTH, TEXT_PADDING } from '../textLayout';
import { exportAnnotatedPdf } from '../annotationExporter';
import type { Annotation } from '../../types/annotations';

const mono = (text: string) => text.length * 6; // 6pt per char

describe('text layout', () => {
  it('wraps words and breaks over-long words', () => {
    expect(layoutTextLines('aaa bbb ccc', 'none', 42, mono).map((l) => l.text)).toEqual(['aaa bbb', 'ccc']);
    expect(layoutTextLines('abcdefghij', 'none', 30, mono).map((l) => l.text)).toEqual(['abcde', 'fghij']);
  });

  it('adds list markers with a hanging indent, skipping blank lines', () => {
    const lines = layoutTextLines('one\n\ntwo', 'number', 200, mono);
    expect(lines.map((l) => l.marker)).toEqual(['1.', undefined, '2.']);
    expect(lines[0].indent).toBeGreaterThan(0);
    expect(layoutTextLines('x', 'bullet', 200, mono)[0].marker).toBe('•');
  });

  it('auto-sizes the box to its content, capped in width', () => {
    const small = autoSizeTextBox({ content: 'hello\nworld!', fontSize: 10, listStyle: 'none' }, mono);
    expect(small.width).toBe(Math.ceil(36 + TEXT_PADDING * 2 + 1));
    expect(small.height).toBe(Math.ceil(2 * 10 * LINE_HEIGHT + TEXT_PADDING * 2));
    const wide = autoSizeTextBox({ content: 'word '.repeat(200), fontSize: 10, listStyle: 'none' }, mono);
    expect(wide.width).toBeLessThanOrEqual(MAX_AUTO_TEXT_WIDTH);
    expect(wide.height).toBeGreaterThan(100);
  });

  it('exports bordered list text', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([300, 300]);
    const text: Annotation = {
      id: 't', type: 'text', pageIndex: 0, bounds: { x: 10, y: 100, width: 200, height: 80 },
      content: 'first\nsecond', fontSize: 12, fontFamily: 'Arial', bold: false, italic: false, underline: true,
      align: 'left', color: '#000000', backgroundColor: '#ffffcc', borderColor: '#ff0000', borderWidth: 1,
      listStyle: 'bullet', opacity: 1, locked: false, createdAt: 0, updatedAt: 0,
    };
    const result = await exportAnnotatedPdf(await doc.save(), new Map([[0, [text]]]));
    expect(result.annotationCount).toBe(1);
  });
});
