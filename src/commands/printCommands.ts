/**
 * Print (⌘P): what you see is what prints — visible annotations are
 * flattened exactly like Export PDF, each page is rendered to an image and the
 * system print dialog is opened for a print-only copy of those images.
 */
import { useFormStore } from '../store/formStore';
import { useDocumentStore } from '../store/documentStore';
import { useAnnotationStore } from '../store/annotationStore';
import { useAssetStore } from '../store/assetStore';
import { buildAnnotationsMap, exportAnnotatedPdf, loadDefaultExportFonts } from '../pdf/annotationExporter';
import { loadPdfDocument } from '../pdf/renderer';
import { errorMessage, notifyUser } from '../utils/notify';

/** ~200 dpi, capped per page so huge pages cannot exhaust memory. */
export const PRINT_DPI = 200;
export const PRINT_MAX_PIXELS = 24_000_000;
const ROOT_CLASS = 'malipdf-print-root';
const STYLE_ID = 'malipdf-print-style';

const PRINT_CSS = `
@media screen { .${ROOT_CLASS} { display: none !important; } }
@media print {
  @page { margin: 0; }
  html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
  body > *:not(.${ROOT_CLASS}) { display: none !important; }
  .${ROOT_CLASS} { display: block !important; }
  .${ROOT_CLASS} .print-page {
    width: 100vw; height: 100vh; display: flex; align-items: center; justify-content: center;
    break-after: page; page-break-after: always; overflow: hidden;
  }
  .${ROOT_CLASS} .print-page:last-child { break-after: auto; page-break-after: auto; }
  .${ROOT_CLASS} img { max-width: 100%; max-height: 100%; object-fit: contain; }
}`;

export function printScale(widthPt: number, heightPt: number): number {
  const scale = PRINT_DPI / 72;
  const pixels = widthPt * scale * heightPt * scale;
  return pixels > PRINT_MAX_PIXELS ? scale * Math.sqrt(PRINT_MAX_PIXELS / pixels) : scale;
}

let printing = false;

export async function printDocument(docId = useDocumentStore.getState().activeDocId): Promise<boolean> {
  if (!docId || printing) return false;
  const doc = useDocumentStore.getState().documents.get(docId);
  const docAnnotations = useAnnotationStore.getState().docAnnotations.get(docId);
  if (!doc || !docAnnotations) return false;

  printing = true;
  const urls: string[] = [];
  try {
    notifyUser('info', 'Preparing pages for printing…');
    const annotations = buildAnnotationsMap(docAnnotations);
    const hasText = [...annotations.values()].some((list) => list.some((a) => a.type === 'text' && !a.hidden));
    const fonts = hasText ? await loadDefaultExportFonts() : undefined;
    const assets = useAssetStore.getState().getAssetsForDocument({ docId, instanceId: doc.instanceId });
    const { data } = await exportAnnotatedPdf(doc.sourceData, annotations, { assets, fonts, formValues: useFormStore.getState().getValues(docId) });

    const pdf = await loadPdfDocument(data);
    try {
      for (let index = 0; index < pdf.numPages; index++) {
        const page = await pdf.getPage(index + 1);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: printScale(base.width, base.height) });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext('2d')!;
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: context, viewport }).promise;
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
        canvas.width = 0;
        canvas.height = 0;
        page.cleanup();
        if (!blob) throw new Error(`Page ${index + 1} could not be rendered.`);
        urls.push(URL.createObjectURL(blob));
      }
    } finally {
      await pdf.destroy();
    }

    await showPrintDialog(urls);
    return true;
  } catch (error) {
    console.error('Print failed:', error);
    notifyUser('error', `Print failed: ${errorMessage(error)}`);
    return false;
  } finally {
    for (const url of urls) URL.revokeObjectURL(url);
    printing = false;
  }
}

async function showPrintDialog(urls: string[]): Promise<void> {
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = PRINT_CSS;
    document.head.appendChild(style);
  }
  const root = document.createElement('div');
  root.className = ROOT_CLASS;
  const images = urls.map((url, index) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'print-page';
    const img = document.createElement('img');
    img.src = url;
    img.alt = `Page ${index + 1}`;
    wrapper.appendChild(img);
    root.appendChild(wrapper);
    return img;
  });
  document.body.appendChild(root);
  try {
    await Promise.all(images.map((img) => img.decode().catch(() => undefined)));
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        window.removeEventListener('afterprint', finish);
        resolve();
      };
      window.addEventListener('afterprint', finish);
      const started = performance.now();
      window.print();
      // Usually window.print() blocks until the dialog is closed; then we are
      // done. Otherwise wait for "afterprint" (with a generous safety net —
      // the print copy is invisible on screen, so waiting costs nothing).
      if (performance.now() - started > 300) finish();
      else setTimeout(finish, 10 * 60_000);
    });
  } finally {
    root.remove();
  }
}
