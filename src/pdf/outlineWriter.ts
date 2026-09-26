/**
 * Writes user bookmarks into the PDF's table of contents (outline) as
 * top-level entries after any existing ones, and can undo that exactly.
 */
import { PDFDict, PDFHexString, PDFName, PDFNumber, PDFRef, type PDFDocument } from 'pdf-lib';
import type { Bookmark } from '../types/annotations';

const N = (name: string) => PDFName.of(name);

export interface OutlineChange {
  hadOutlines: boolean;
  outlinesRef: PDFRef;
  oldLast: PDFRef | null;
  oldCount: number | null;
}

export function appendBookmarksToOutline(pdfDoc: PDFDocument, bookmarks: readonly Bookmark[]): OutlineChange | null {
  const pages = pdfDoc.getPages();
  const valid = bookmarks.filter((bookmark) => bookmark.pageIndex >= 0 && bookmark.pageIndex < pages.length);
  if (valid.length === 0) return null;

  const context = pdfDoc.context;
  const catalog = pdfDoc.catalog;
  const existing = catalog.get(N('Outlines'));
  const existingDict = context.lookupMaybe(existing, PDFDict);
  const hadOutlines = existingDict !== undefined;

  let outlines: PDFDict;
  let outlinesRef: PDFRef;
  if (existingDict && existing instanceof PDFRef) {
    outlines = existingDict;
    outlinesRef = existing;
  } else {
    outlines = existingDict ?? (context.obj({ Type: 'Outlines' }) as PDFDict);
    outlinesRef = context.register(outlines);
    catalog.set(N('Outlines'), outlinesRef);
  }

  const lastValue = outlines.get(N('Last'));
  const oldLast = lastValue instanceof PDFRef && context.lookupMaybe(lastValue, PDFDict) ? lastValue : null;
  const oldCount = outlines.lookupMaybe(N('Count'), PDFNumber)?.asNumber() ?? null;

  const refs = valid.map(() => context.nextRef());
  valid.forEach((bookmark, index) => {
    const item = context.obj({
      Title: PDFHexString.fromText(bookmark.title),
      Parent: outlinesRef,
      Dest: [pages[bookmark.pageIndex].ref, N('Fit')],
    }) as PDFDict;
    const previous = index > 0 ? refs[index - 1] : oldLast;
    if (previous) item.set(N('Prev'), previous);
    if (index < refs.length - 1) item.set(N('Next'), refs[index + 1]);
    context.assign(refs[index], item);
  });

  if (oldLast) context.lookup(oldLast, PDFDict).set(N('Next'), refs[0]);
  else outlines.set(N('First'), refs[0]);
  outlines.set(N('Last'), refs[refs.length - 1]);
  // Count = number of visible entries (negative when the outline is closed).
  const count = oldCount !== null && oldCount < 0 ? oldCount - refs.length : (oldCount ?? 0) + refs.length;
  outlines.set(N('Count'), PDFNumber.of(count));

  return { hadOutlines, outlinesRef, oldLast, oldCount };
}

/** Undo appendBookmarksToOutline (the added items become garbage). */
export function removeAppendedBookmarks(pdfDoc: PDFDocument, change: OutlineChange): void {
  const context = pdfDoc.context;
  if (!change.hadOutlines) {
    pdfDoc.catalog.delete(N('Outlines'));
    return;
  }
  const outlines = context.lookupMaybe(change.outlinesRef, PDFDict);
  if (!outlines) return;
  if (change.oldLast) {
    context.lookupMaybe(change.oldLast, PDFDict)?.delete(N('Next'));
    outlines.set(N('Last'), change.oldLast);
  } else {
    outlines.delete(N('First'));
    outlines.delete(N('Last'));
  }
  if (change.oldCount === null) outlines.delete(N('Count'));
  else outlines.set(N('Count'), PDFNumber.of(change.oldCount));
}
