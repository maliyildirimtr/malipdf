/**
 * Infinite page: add room at the bottom of a page, so a note can keep going.
 *
 * The page's MediaBox (and CropBox) grow downwards; content and annotations
 * keep their PDF coordinates, so nothing moves. One undo step. With "Endless
 * page" on, writing near the bottom of a page extends it automatically.
 */
import { activeDocument, mutateDocumentBytes } from './documentBytesCommands';
import { useDocumentStore } from '../store/documentStore';
import { notifyUser } from '../utils/notify';

/** Largest page height MaliPDF grows a page to (200 inches is the PDF limit). */
export const MAX_PAGE_HEIGHT = 14400;
/** Writing this close to the bottom (fraction of the page height) extends it. */
export const AUTO_EXTEND_ZONE = 0.12;

/** New box with `extra` points added at the bottom, or null when it cannot grow. */
export function extendedBox(box: { x: number; y: number; width: number; height: number }, extra: number) {
  const room = Math.min(extra, MAX_PAGE_HEIGHT - box.height);
  if (!(room >= 1)) return null;
  return { x: box.x, y: box.y - room, width: box.width, height: box.height + room };
}

let running = false;

/** Add `fraction` of the page's height below page `pageIndex` of the active document. */
export async function extendPage(pageIndex: number, fraction = 0.5, quiet = false): Promise<boolean> {
  const doc = activeDocument();
  if (!doc || running) return false;
  if (((doc.pageRotations[pageIndex] ?? 0) % 360) !== 0) {
    if (!quiet) notifyUser('info', 'Rotated pages cannot be extended. Rotate the page back first.');
    return false;
  }
  running = true;
  try {
    let grown = false;
    const result = await mutateDocumentBytes(doc, async (pdf) => {
      if (pageIndex < 0 || pageIndex >= pdf.getPageCount()) return false;
      const page = pdf.getPage(pageIndex);
      if ((page.getRotation().angle % 360) !== 0) return false;
      const media = page.getMediaBox();
      const crop = page.getCropBox();
      const next = extendedBox(media, media.height * fraction);
      if (!next) return false;
      page.setMediaBox(next.x, next.y, next.width, next.height);
      // The visible area grows too (a crop keeps its sides, gains the new bottom).
      const cropBottom = Math.abs(crop.y - media.y) < 0.5 ? next.y : crop.y;
      page.setCropBox(crop.x, cropBottom, crop.width, crop.y + crop.height - cropBottom);
      grown = true;
      return true;
    }, 'The page could not be extended');
    if (result === null || !grown) {
      if (!quiet) notifyUser('info', 'This page cannot grow any longer.');
      return false;
    }
    if (!quiet) notifyUser('success', 'Added room at the bottom of the page. Undo (⌘Z) removes it.');
    return true;
  } finally {
    running = false;
  }
}

/** Endless page: after a stroke near the bottom, extend that page. */
export function maybeAutoExtend(docId: string, pageIndex: number, lowestY: number, pageBottom: number, pageHeight: number): void {
  if (useDocumentStore.getState().activeDocId !== docId) return;
  if (lowestY - pageBottom > pageHeight * AUTO_EXTEND_ZONE) return;
  void extendPage(pageIndex, 0.5, true);
}
