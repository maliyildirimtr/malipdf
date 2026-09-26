/**
 * Snapshot tool: copy a region of a page — the PDF and the annotations on
 * it — to the clipboard as a sharp PNG, ready to paste here or elsewhere.
 */
import { useAnnotationStore } from '../store/annotationStore';
import { getDocumentProxy } from '../pdf/documentManager';
import { createPageTransform, pdfRectToScreenBounds } from '../pdf/coordinateTransform';
import { renderAnnotations } from '../pdf/annotationRenderer';
import type { PdfRect } from '../types/annotations';
import type { DocumentIdentity } from '../types/documentSession';
import { errorMessage, notifyUser } from '../utils/notify';

/** Pixels per PDF point in the snapshot (≈ 216 dpi). */
const SNAPSHOT_SCALE = 3;
/** Longest side, so huge regions stay within canvas limits. */
const MAX_SIDE = 8000;

export async function renderSnapshot(identity: DocumentIdentity, pageIndex: number, rect: PdfRect, rotation = 0): Promise<HTMLCanvasElement> {
  const proxy = getDocumentProxy(identity);
  if (!proxy) throw new Error('The document is not open.');
  const page = await proxy.getPage(pageIndex + 1);
  const unit = pdfRectToScreenBounds(rect, createPageTransform(page, { scale: 1, displayRotation: rotation }));
  const scale = Math.min(SNAPSHOT_SCALE, MAX_SIDE / Math.max(unit.width, unit.height, 1));
  const transform = createPageTransform(page, { scale, displayRotation: rotation });
  const region = pdfRectToScreenBounds(rect, transform);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(region.width));
  canvas.height = Math.max(1, Math.round(region.height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not draw the snapshot.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({
    canvasContext: ctx,
    viewport: transform.viewport,
    transform: [1, 0, 0, 1, -region.x, -region.y],
  }).promise;
  const annotations = useAnnotationStore.getState().getPageAnnotations(identity.docId, pageIndex).filter((a) => !a.hidden);
  ctx.save();
  ctx.translate(-region.x, -region.y);
  renderAnnotations(ctx, annotations, transform, 1, identity);
  ctx.restore();
  return canvas;
}

async function writeClipboard(blob: Blob): Promise<void> {
  const api = window.electronAPI;
  if (api?.writeClipboardImage) {
    await api.writeClipboardImage(await blob.arrayBuffer());
    return;
  }
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

/** Copy `rect` (PDF space) of a page to the clipboard. */
export async function copySnapshot(identity: DocumentIdentity, pageIndex: number, rect: PdfRect, rotation = 0): Promise<boolean> {
  try {
    const canvas = await renderSnapshot(identity, pageIndex, rect, rotation);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    canvas.width = canvas.height = 0;
    if (!blob) throw new Error('Could not make the image.');
    await writeClipboard(blob);
    notifyUser('success', 'Snapshot copied. Paste it with ⌘V — here, in Notes, Word or anywhere.');
    return true;
  } catch (error) {
    notifyUser('error', `The snapshot could not be copied: ${errorMessage(error)}`);
    return false;
  }
}
