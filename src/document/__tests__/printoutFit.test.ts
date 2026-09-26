import { describe, expect, it } from 'vitest';
import { PDFDocument, degrees } from 'pdf-lib';
import { displayedPageSize, fitPrintoutToPage } from '../documentMutator';

describe('printout page size', () => {
  it('gives a 16:9 slide a page as wide as landscape A4, in the slide shape', () => {
    const [slide] = fitPrintoutToPage([{ width: 960, height: 540 }], { width: 595, height: 842 });
    expect(slide.page.width).toBeCloseTo(842);
    expect(slide.page.height).toBeCloseTo(473.625);
    expect(slide.image).toEqual({ x: 0, y: 0, ...slide.page });
  });

  it('keeps portrait printouts portrait', () => {
    const [page] = fitPrintoutToPage([{ width: 612, height: 792 }], { width: 842, height: 595 });
    expect(page.page.width).toBeCloseTo(595);
    expect(page.page.height).toBeCloseTo(792 * (595 / 612));
  });

  it('keeps the original size when there is no page to match', () => {
    expect(fitPrintoutToPage([{ width: 300, height: 200 }], null)).toEqual([
      { page: { width: 300, height: 200 }, image: { x: 0, y: 0, width: 300, height: 200 } },
    ]);
  });

  it('reads the shown size of a (rotated) page', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    doc.addPage([595, 842]).setRotation(degrees(90));
    const bytes = await doc.save();
    expect(await displayedPageSize(bytes, 0)).toEqual({ width: 595, height: 842 });
    expect(await displayedPageSize(bytes, 1)).toEqual({ width: 842, height: 595 });
  });
});
