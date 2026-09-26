import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { imagesToPdf, layoutImage } from '../imagesToPdf';

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

describe('PDF from images', () => {
  it('turns A4 to landscape for wide pictures and centres them', () => {
    const { page, box } = layoutImage(4000, 3000, 'a4', 20);
    expect(page[0]).toBeGreaterThan(page[1]);
    expect(box.x + box.width / 2).toBeCloseTo(page[0] / 2);
    expect(box.height).toBeLessThanOrEqual(page[1] - 40 + 1e-6);
  });

  it('makes one page per image', async () => {
    const bytes = await imagesToPdf([
      { mimeType: 'image/png', width: 1000, height: 500, data: PNG },
      { mimeType: 'image/png', width: 500, height: 1000, data: PNG },
    ], 'image', 0);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(0).getWidth()).toBeGreaterThan(doc.getPage(0).getHeight());
  });
});
