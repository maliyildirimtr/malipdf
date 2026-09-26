/** Crop tool: keep only part of a page (the PDF CropBox), as one undo step. */
import { activeDocument, mutateDocumentBytes } from './documentBytesCommands';
import type { PdfRect } from '../types/annotations';
import { notifyUser } from '../utils/notify';

/** `rect` ∩ `box`, or null when they do not overlap enough. */
export function intersectRect(rect: PdfRect, box: PdfRect): PdfRect | null {
  const x = Math.max(rect.x, box.x);
  const y = Math.max(rect.y, box.y);
  const r = Math.min(rect.x + rect.width, box.x + box.width);
  const t = Math.min(rect.y + rect.height, box.y + box.height);
  return r - x >= 10 && t - y >= 10 ? { x, y, width: r - x, height: t - y } : null;
}

/** Crop `pages` to `rect` (PDF space); `rect` null removes the crop. */
export async function cropPages(pages: readonly number[], rect: PdfRect | null): Promise<boolean> {
  const doc = activeDocument();
  if (!doc || pages.length === 0) return false;
  let changed = 0;
  const result = await mutateDocumentBytes(doc, async (pdf) => {
    for (const index of pages) {
      if (index < 0 || index >= pdf.getPageCount()) continue;
      const page = pdf.getPage(index);
      const media = page.getMediaBox();
      const target = rect ? intersectRect(rect, media) : media;
      if (!target) continue;
      page.setCropBox(target.x, target.y, target.width, target.height);
      changed++;
    }
    return changed > 0;
  }, 'The page could not be cropped');
  if (result === null) {
    if (changed === 0) notifyUser('info', 'Nothing to crop there.');
    return false;
  }
  notifyUser('success', rect
    ? `Cropped ${changed} page${changed === 1 ? '' : 's'}. Undo (⌘Z) brings the edges back.`
    : `Crop removed from ${changed} page${changed === 1 ? '' : 's'}.`);
  return true;
}
