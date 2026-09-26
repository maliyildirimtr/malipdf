import { PDFDocument } from 'pdf-lib';

/**
 * Inserts the pages of `pdfToInsertBytes` into `sourceBytes` immediately after `insertAfterIndex`.
 * 
 * @param sourceBytes The original PDF bytes
 * @param pdfToInsertBytes The PDF bytes to insert
 * @param insertAfterIndex The 0-based index of the page after which to insert. Use -1 to insert at the beginning.
 * @returns A promise resolving to the mutated PDF bytes, and the number of pages inserted
 */
export async function insertPdfPages(
  sourceBytes: Uint8Array,
  pdfToInsertBytes: Uint8Array,
  insertAfterIndex: number,
): Promise<{ mutatedBytes: Uint8Array; insertedPageCount: number }> {
  const targetDoc = await PDFDocument.load(sourceBytes);
  const sourceDoc = await PDFDocument.load(pdfToInsertBytes);

  const copiedPages = await targetDoc.copyPages(sourceDoc, sourceDoc.getPageIndices());
  
  let insertionIndex = insertAfterIndex + 1;
  // Ensure we don't insert past the end of the document
  if (insertionIndex > targetDoc.getPageCount()) {
    insertionIndex = targetDoc.getPageCount();
  }

  for (let i = 0; i < copiedPages.length; i++) {
    targetDoc.insertPage(insertionIndex + i, copiedPages[i]);
  }

  const mutatedBytes = await targetDoc.save();
  return {
    mutatedBytes,
    insertedPageCount: copiedPages.length,
  };
}

export interface BlankPageSpec {
  width: number;
  height: number;
}

/**
 * Inserts blank pages into `sourceBytes` immediately after `insertAfterIndex`.
 * 
 * @param sourceBytes The original PDF bytes
 * @param insertAfterIndex The 0-based index of the page after which to insert. Use -1 to insert at the beginning.
 * @param pageSpecs The dimensions of the blank pages to insert.
 * @returns A promise resolving to the mutated PDF bytes.
 */
/** Size of a page as it is shown (width/height swapped for 90°/270° pages). */
export async function displayedPageSize(sourceBytes: Uint8Array, pageIndex: number): Promise<{ width: number; height: number } | null> {
  const doc = await PDFDocument.load(sourceBytes, { updateMetadata: false });
  if (doc.getPageCount() === 0) return null;
  const page = doc.getPage(Math.max(0, Math.min(doc.getPageCount() - 1, pageIndex)));
  const { width, height } = page.getSize();
  return page.getRotation().angle % 180 === 0 ? { width, height } : { width: height, height: width };
}

/**
 * Printout pages are scaled to the width of the page they follow, so a
 * 16:9 slide does not come out much bigger than the document's own pages.
 */
export function fitPrintoutToWidth(
  pages: readonly { width: number; height: number }[],
  targetWidth: number | null,
): { width: number; height: number }[] {
  return pages.map((p) => {
    if (!targetWidth || !(targetWidth > 0) || !(p.width > 0)) return { width: p.width, height: p.height };
    const scale = targetWidth / p.width;
    return { width: p.width * scale, height: p.height * scale };
  });
}

export async function insertBlankPagesAfter(
  sourceBytes: Uint8Array,
  insertAfterIndex: number,
  pageSpecs: BlankPageSpec[],
): Promise<Uint8Array> {
  const targetDoc = await PDFDocument.load(sourceBytes);

  let insertionIndex = insertAfterIndex + 1;
  // Ensure we don't insert past the end of the document
  if (insertionIndex > targetDoc.getPageCount()) {
    insertionIndex = targetDoc.getPageCount();
  }

  for (let i = 0; i < pageSpecs.length; i++) {
    const spec = pageSpecs[i];
    targetDoc.insertPage(insertionIndex + i, [spec.width, spec.height]);
  }

  return await targetDoc.save();
}
