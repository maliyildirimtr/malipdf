import { describe, expect, it } from 'vitest';
import { PDFDocument, degrees } from 'pdf-lib';
import { displayedPageSize, fitPrintoutToWidth } from '../documentMutator';

describe('printout page size', () => {
  it('scales slides to the width of the page they follow', () => {
    expect(fitPrintoutToWidth([{ width: 960, height: 540 }], 595)).toEqual([{ width: 595, height: 334.6875 }]);
    expect(fitPrintoutToWidth([{ width: 300, height: 200 }], null)).toEqual([{ width: 300, height: 200 }]);
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
