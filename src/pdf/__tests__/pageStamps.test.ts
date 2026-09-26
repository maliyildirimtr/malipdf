import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { applyPageStamps, fillPlaceholders, formatPageNumber, visualFrame } from '../pageStamps';

const fontkitName = '@pdf-lib/fontkit';
const fontkit = await import(/* @vite-ignore */ fontkitName).then((m) => m.default, () => null);

async function textOf(bytes: Uint8Array, pageNumber: number) {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
  const page = await doc.getPage(pageNumber);
  const content = await page.getTextContent();
  const vp = page.getViewport({ scale: 1 });
  return content.items.map((it: any) => {
    const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
    return { str: it.str as string, x, y, w: vp.width, h: vp.height };
  });
}

describe('page stamps', () => {
  it('formats numbers and placeholders', () => {
    expect(formatPageNumber('page-n-of-total', 3, 10)).toBe('Page 3 of 10');
    expect(formatPageNumber('n-of-total', 3, 10)).toBe('3 / 10');
    expect(fillPlaceholders('{title} – {page}/{pages} – {date}', { page: 2, pages: 5, date: '27.09.2026', title: 'Ders' })).toBe('Ders – 2/5 – 27.09.2026');
  });

  it('maps visual positions on rotated pages', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([600, 400]);
    page.setRotation(degrees(90));
    const frame = visualFrame(page);
    expect([frame.width, frame.height]).toEqual([400, 600]);
    expect(frame.toPdf(0, 0)).toEqual({ x: 600, y: 0 });
  });

  it('puts numbers at the bottom and header at the top, also on a rotated page', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([595, 842]);
    pdf.addPage([595, 842]).setRotation(degrees(90));
    let font;
    if (fontkit) {
      pdf.registerFontkit(fontkit);
      font = await pdf.embedFont(readFileSync(resolve(__dirname, '../../assets/fonts/LiberationSans-Regular.ttf')), { subset: true });
    } else {
      font = await pdf.embedFont(StandardFonts.Helvetica);
    }
    const n = applyPageStamps(pdf, {
      pages: [0, 1], fontSize: 10, color: '#444444',
      pageNumbers: { format: 'n-of-total', position: 'bottom', align: 'center', start: 1 },
      header: { text: fontkit ? 'Işık Ders {page}' : 'Ders {page}', align: 'left' },
      watermark: { text: 'TASLAK', opacity: 0.15, size: 60, color: '#ff0000', diagonal: true },
    }, font, { title: 'x', date: 'd' });
    expect(n).toBe(2);
    const bytes = await pdf.save();
    for (const p of [1, 2]) {
      const items = await textOf(bytes, p);
      const num = items.find((i) => i.str === `${p} / 2`)!;
      expect(num).toBeDefined();
      expect(num.y).toBeGreaterThan(num.h * 0.9); // viewport y grows down: bottom of the shown page
      expect(Math.abs(num.x - num.w / 2)).toBeLessThan(40);
      const header = items.find((i) => i.str.includes('Ders'))!;
      expect(header.y).toBeLessThan(header.h * 0.1);
      expect(items.some((i) => i.str === 'TASLAK')).toBe(true);
    }
  });
});
