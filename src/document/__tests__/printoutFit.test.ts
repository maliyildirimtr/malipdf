import { describe, expect, it } from 'vitest';
import { PDFDocument, degrees } from 'pdf-lib';
import { displayedPageSize, fitPrintoutToPage } from '../documentMutator';

describe('printout page size', () => {
  it('puts a landscape slide on a landscape page of the same paper size', () => {
    const [slide] = fitPrintoutToPage([{ width: 960, height: 540 }], { width: 595, height: 842 });
    expect(slide.page).toEqual({ width: 842, height: 595 });
    expect(slide.image.width).toBeCloseTo(842);
    expect(slide.image.height).toBeCloseTo(473.625);
    expect(slide.image.x).toBeCloseTo(0);
    expect(slide.image.y).toBeCloseTo((595 - 473.625) / 2);
  });

  it('keeps portrait printouts portrait and centers them', () => {
    const [page] = fitPrintoutToPage([{ width: 612, height: 792 }], { width: 842, height: 595 });
    expect(page.page).toEqual({ width: 595, height: 842 });
    expect(page.image.width).toBeCloseTo(595);
    expect(page.image.y).toBeCloseTo((842 - 792 * (595 / 612)) / 2);
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
