import { describe, expect, it } from 'vitest';
import { generateNewDocument } from '../newDocumentGenerator';
import { PDFDocument } from 'pdf-lib';

describe('newDocumentGenerator', () => {
  it('generates a blank document', async () => {
    const bytes = await generateNewDocument({
      widthPt: 595,
      heightPt: 842,
      background: { type: 'blank' },
      pageCount: 1,
    });

    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const page = doc.getPage(0);
    expect(page.getSize().width).toBeCloseTo(595);
    expect(page.getSize().height).toBeCloseTo(842);
  });

  it('generates a grid background', async () => {
    const bytes = await generateNewDocument({
      widthPt: 595,
      heightPt: 842,
      background: { 
        type: 'grid', 
        spacingMm: 5, 
        color: '#ff0000', 
        opacity: 0.5, 
        weight: 'normal' 
      },
      pageCount: 2,
    });

    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
  });

  it('generates a lined background', async () => {
    const bytes = await generateNewDocument({
      widthPt: 595,
      heightPt: 842,
      background: { 
        type: 'lined', 
        spacingMm: 10, 
        color: '#00ff00', 
        opacity: 1, 
        weight: 'strong' 
      },
      pageCount: 1,
    });

    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it('generates a dotted background', async () => {
    const bytes = await generateNewDocument({
      widthPt: 200,
      heightPt: 200,
      background: { 
        type: 'dotted', 
        spacingMm: 10, 
        color: '#0000ff', 
        opacity: 0.5, 
        weight: 'light' 
      },
      pageCount: 1,
    });

    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it('generates a millimetric background', async () => {
    const bytes = await generateNewDocument({
      widthPt: 200, // keep size small for test speed
      heightPt: 200,
      background: { 
        type: 'millimetric', 
        majorSpacingMm: 5, 
        color: '#999999', 
        minorOpacity: 0.3, 
        majorOpacity: 1.0, 
        minorWeight: 'light', 
        majorWeight: 'strong' 
      },
      pageCount: 1,
    });

    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it('throws an error if complexity is too high', async () => {
    await expect(generateNewDocument({
      widthPt: 3000,
      heightPt: 4000, // extremely large page
      background: { 
        type: 'millimetric', 
        majorSpacingMm: 5, 
        color: '#000', 
        minorOpacity: 0.5, 
        majorOpacity: 1, 
        minorWeight: 'light', 
        majorWeight: 'normal' 
      },
      pageCount: 1000, // many pages
    })).rejects.toThrow(/complexity too high/);
  });
});
