import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { exportAnnotatedPdf } from '../annotationExporter';
import { sampleColors } from '../../commands/textEditCommands';
import { getAnnotationBounds } from '../annotationGeometry';
import { hitTestAnnotation } from '../annotationHitTest';
import type { Annotation, TextEditAnnotation } from '../../types/annotations';

const fontkitName = '@pdf-lib/fontkit';
const fontkit = await import(/* @vite-ignore */ fontkitName).then((m) => m.default, () => null);
const fonts = fontkit
  ? { fontkit, load: async () => new Uint8Array(readFileSync(resolve(__dirname, '../../assets/fonts/LiberationSans-Regular.ttf'))) }
  : undefined;

const edit = (patch: Partial<TextEditAnnotation> = {}): TextEditAnnotation => ({
  id: 'e1', pageIndex: 0, type: 'textEdit', origin: { x: 50, y: 700 }, angle: 0, originalWidth: 80, ascent: 11, descent: 3,
  original: 'Hello world', text: fontkit ? 'Merhaba dünya' : 'Merhaba', textWidth: 90, fontSize: 12,
  fontFamily: 'Arial, sans-serif', bold: false, italic: false, color: '#000000', background: '#ffffff',
  opacity: 1, locked: false, createdAt: 0, updatedAt: 0, ...patch,
});

describe('edit PDF text', () => {
  it('covers the longer of old and new text', () => {
    const b = getAnnotationBounds(edit());
    expect(b.x).toBeLessThan(50);
    expect(b.x + b.width).toBeGreaterThanOrEqual(50 + 90);
    expect(hitTestAnnotation({ x: 60, y: 704 }, edit(), 1)).toBe(true);
    expect(hitTestAnnotation({ x: 60, y: 730 }, edit(), 1)).toBe(false);
  });

  it('exports the new text over a cover', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    page.drawText('Hello world', { x: 50, y: 700, size: 12, font: await doc.embedFont(StandardFonts.Helvetica), color: rgb(0, 0, 0) });
    const out = await exportAnnotatedPdf(await doc.save(), new Map([[0, [edit() as Annotation]]]), { fonts });
    const pdf = await pdfjs.getDocument({ data: out.data, isEvalSupported: false }).promise;
    const items = (await (await pdf.getPage(1)).getTextContent()).items.map((i: any) => i.str);
    expect(items).toContain(fontkit ? 'Merhaba dünya' : 'Merhaba');
  });

  it('reads text and background colours from pixels', () => {
    const w = 20, h = 10;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) { data.set([250, 240, 200, 255], i * 4); }
    for (let x = 5; x < 15; x++) for (let y = 3; y < 7; y++) data.set([200, 0, 0, 255], (y * w + x) * 4);
    const c = sampleColors(data, w, h);
    expect(c.background).toBe('#faf0c8');
    expect(c.color).toBe('#c80000');
  });
});
