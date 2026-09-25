/**
 * Turkish / Unicode text export with the bundled Liberation Sans fonts.
 * Needs @pdf-lib/fontkit (a regular dependency); skipped until `npm install`
 * has been run so a fresh checkout still has a green suite.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PDFDocument } from 'pdf-lib';
import { exportAnnotatedPdf } from '../annotationExporter';
import type { Annotation } from '../../types/annotations';

const fontkitName = '@pdf-lib/fontkit';
const fontkit = await import(/* @vite-ignore */ fontkitName).then((m) => m.default, () => null);

const font = (file: string) => new Uint8Array(readFileSync(resolve(__dirname, '../../assets/fonts', file)));

describe.skipIf(!fontkit)('Unicode text export (bundled fonts)', () => {
  it('writes Turkish text in all four styles', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([400, 400]);
    const source = await doc.save();
    const fonts = {
      fontkit,
      regular: font('LiberationSans-Regular.ttf'),
      bold: font('LiberationSans-Bold.ttf'),
      italic: font('LiberationSans-Italic.ttf'),
      boldItalic: font('LiberationSans-BoldItalic.ttf'),
    };
    const texts: Annotation[] = [[false, false], [true, false], [false, true], [true, true]].map(([bold, italic], i) => ({
      id: `t${i}`, type: 'text', pageIndex: 0, color: '#000000', opacity: 1, locked: false, createdAt: 0, updatedAt: 0,
      bounds: { x: 10, y: 300 - i * 70, width: 300, height: 60 },
      content: 'Iğdır’da çalışan şoför İsmail ÖĞÜŞ\nikinci satır',
      fontSize: 12, fontFamily: 'Inter', bold, italic, underline: false, align: 'left', backgroundColor: 'transparent',
    }));

    const result = await exportAnnotatedPdf(source, new Map([[0, texts]]), { fonts });
    expect(result.annotationCount).toBe(4);
    const reloaded = await PDFDocument.load(result.data);
    expect(reloaded.getPageCount()).toBe(1);
  });
});
