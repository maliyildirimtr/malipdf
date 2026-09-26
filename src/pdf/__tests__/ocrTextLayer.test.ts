import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { hasRealText, placeWords, writeInvisibleText, type OcrLine } from '../ocr';
import { createPageTransform } from '../coordinateTransform';

const fontBytes = new Uint8Array(readFileSync(resolve(__dirname, '../../assets/fonts/LiberationSans-Regular.ttf')));

describe('OCR text layer', () => {
  it('places words from the image onto the page and makes them findable', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([600, 800]);
    const bytes = await doc.save();

    const loaded = await pdfjs.getDocument({ data: bytes.slice() }).promise;
    const page = await loaded.getPage(1);
    const transform = createPageTransform(page as never, { scale: 2 });
    // "Merhaba dünya" near the top-left of a 1200×1600 image.
    const lines: OcrLine[] = [{
      text: 'Merhaba dünya', confidence: 0.99, box: [0.1, 0.1, 0.4, 0.03],
      words: [
        { text: 'Merhaba', box: [0.1, 0.1, 0.2, 0.03] },
        { text: 'dünya', box: [0.32, 0.1, 0.18, 0.03] },
      ],
    }];
    const words = placeWords(lines, transform);
    expect(words).toHaveLength(2);
    expect(words[0].bl.x).toBeCloseTo(60);
    expect(words[0].bl.y).toBeCloseTo(800 - (0.13 * 800));
    expect(words[0].tl.y).toBeCloseTo(800 - (0.1 * 800));
    await loaded.destroy();

    const pdf = await PDFDocument.load(bytes);
    pdf.registerFontkit(fontkit);
    const font = await pdf.embedFont(fontBytes, { subset: true });
    expect(writeInvisibleText(pdf, font, 0, words)).toBe(2);
    const out = await pdf.save();

    const reopened = await pdfjs.getDocument({ data: out.slice() }).promise;
    const content = await (await reopened.getPage(1)).getTextContent();
    const items = content.items as { str: string; transform: number[] }[];
    expect(hasRealText(items)).toBe(true);
    expect(items.map((i) => i.str).join(' ')).toContain('Merhaba');
    expect(items.map((i) => i.str).join(' ')).toContain('dünya');
    const merhaba = items.find((i) => i.str.includes('Merhaba'))!;
    expect(merhaba.transform[4]).toBeCloseTo(60, 0);
    await reopened.destroy();
  });

  it('knows blank text from real text', () => {
    expect(hasRealText([{ str: ' ' }, { str: '' }])).toBe(false);
    expect(hasRealText([{ str: 'a' }])).toBe(true);
  });
});
