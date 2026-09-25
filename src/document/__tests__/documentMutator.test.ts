import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { insertPdfPages } from '../documentMutator';

async function createEmptyPdf(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    doc.addPage([100, 100]); // Add 100x100 pages
  }
  return await doc.save();
}

describe('documentMutator', () => {
  it('inserts pages at the beginning when insertAfterIndex is -1', async () => {
    const source = await createEmptyPdf(2);
    const toInsert = await createEmptyPdf(3);

    const { mutatedBytes, insertedPageCount } = await insertPdfPages(source, toInsert, -1);
    expect(insertedPageCount).toBe(3);

    const mutatedDoc = await PDFDocument.load(mutatedBytes);
    expect(mutatedDoc.getPageCount()).toBe(5);
  });

  it('inserts pages in the middle', async () => {
    const source = await createEmptyPdf(3);
    const toInsert = await createEmptyPdf(2);

    const { mutatedBytes, insertedPageCount } = await insertPdfPages(source, toInsert, 1);
    expect(insertedPageCount).toBe(2);

    const mutatedDoc = await PDFDocument.load(mutatedBytes);
    expect(mutatedDoc.getPageCount()).toBe(5);
  });

  it('inserts pages at the end', async () => {
    const source = await createEmptyPdf(2);
    const toInsert = await createEmptyPdf(4);

    const { mutatedBytes, insertedPageCount } = await insertPdfPages(source, toInsert, 1);
    expect(insertedPageCount).toBe(4);

    const mutatedDoc = await PDFDocument.load(mutatedBytes);
    expect(mutatedDoc.getPageCount()).toBe(6);
  });

  it('caps insertion index to the end of the document if insertAfterIndex is too large', async () => {
    const source = await createEmptyPdf(2);
    const toInsert = await createEmptyPdf(1);

    const { mutatedBytes, insertedPageCount } = await insertPdfPages(source, toInsert, 5);
    expect(insertedPageCount).toBe(1);

    const mutatedDoc = await PDFDocument.load(mutatedBytes);
    expect(mutatedDoc.getPageCount()).toBe(3);
  });
});

describe('insertBlankPagesAfter', () => {
  it('inserts blank pages with correct dimensions after target index', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([100, 200]);
    doc.addPage([150, 250]);
    const sourceBytes = await doc.save();

    const { insertBlankPagesAfter } = await import('../documentMutator');
    const resultBytes = await insertBlankPagesAfter(sourceBytes, 0, [
      { width: 300, height: 400 },
      { width: 350, height: 450 },
    ]);

    const resultDoc = await PDFDocument.load(resultBytes);
    expect(resultDoc.getPageCount()).toBe(4);
    
    // Page 0 should be untouched
    expect(resultDoc.getPage(0).getWidth()).toBe(100);
    
    // Page 1 should be the first blank page
    expect(resultDoc.getPage(1).getWidth()).toBe(300);
    expect(resultDoc.getPage(1).getHeight()).toBe(400);

    // Page 2 should be the second blank page
    expect(resultDoc.getPage(2).getWidth()).toBe(350);
    expect(resultDoc.getPage(2).getHeight()).toBe(450);

    // Page 3 should be the original second page
    expect(resultDoc.getPage(3).getWidth()).toBe(150);
  });
});
