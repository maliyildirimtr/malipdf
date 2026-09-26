/**
 * Recognize Text (OCR) and Convert Handwriting to Text.
 *
 * Both use macOS's own text recognition (Vision) through the Electron helper,
 * so they work offline. OCR adds an invisible text layer to scanned pages (one
 * undo step); handwriting conversion replaces the selected ink with a text box.
 */
import { PDFDocument } from 'pdf-lib';
import { useDocumentStore } from '../store/documentStore';
import { useAnnotationStore } from '../store/annotationStore';
import { useHistoryStore, makeAddAction, makeBatchAction, makeMutateDocumentBytesAction, makeRemoveAction, type HistoryActionDraft } from '../store/historyStore';
import { useSelectionStore } from '../store/selectionStore';
import { useTaskProgressStore } from '../store/taskProgressStore';
import { useUIStore } from '../store/uiStore';
import { getDocumentProxy } from '../pdf/documentManager';
import { createPageTransform, type PageTransform } from '../pdf/coordinateTransform';
import { hasRealText, placeWords, writeInvisibleText, type OcrLine, type PlacedWord } from '../pdf/ocr';
import { loadExportFonts } from '../pdf/exportFonts';
import { getGroupBounds } from '../pdf/annotationGeometry';
import { renderAnnotations } from '../pdf/annotationRenderer';
import { autoSizeTextBox, canvasMeasure } from '../pdf/textLayout';
import type { Annotation, DocumentState, TextAnnotation } from '../types/annotations';
import { nanoid } from '../utils/nanoid';
import { errorMessage, notifyUser } from '../utils/notify';

/** Longest side of the page image sent for recognition. */
const OCR_IMAGE_PX = 2600;

async function recognitionAvailable(): Promise<boolean> {
  const api = window.electronAPI;
  if (!api?.ocrRecognize || !api.ocrIsAvailable) {
    notifyUser('error', 'Text recognition needs the MaliPDF desktop app on macOS.');
    return false;
  }
  if (!(await api.ocrIsAvailable())) {
    notifyUser('error', 'Text recognition is not built yet. In the project folder run: npm run build:ocr (needs Xcode Command Line Tools), then restart MaliPDF.');
    return false;
  }
  return true;
}

async function canvasToPng(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not prepare the image for recognition.');
  return blob.arrayBuffer();
}

function activeDocument(): DocumentState | null {
  const store = useDocumentStore.getState();
  return store.activeDocId ? store.documents.get(store.activeDocId) ?? null : null;
}

function allAnnotations(docId: string): Annotation[] {
  const state = useAnnotationStore.getState().docAnnotations.get(docId);
  return state ? [...state.pages.values()].flatMap((p) => p.annotations) : [];
}

// ─── OCR ──────────────────────────────────────────────────────────────────────

let ocrRunning = false;

/** Recognise text on the current page or on every page that has no text yet. */
export async function recognizeText(scope: 'page' | 'all'): Promise<void> {
  const doc = activeDocument();
  if (!doc || ocrRunning) return;
  if (!(await recognitionAvailable())) return;
  const identity = { docId: doc.id, instanceId: doc.instanceId };
  const proxy = getDocumentProxy(identity);
  if (!proxy) return;

  ocrRunning = true;
  const pages = scope === 'page' ? [doc.activePageIndex] : Array.from({ length: doc.pageCount }, (_, i) => i);
  const progress = useTaskProgressStore.getState();
  const taskId = progress.start('Recognizing text…', pages.length);
  const baseBytes = doc.sourceData;
  const found = new Map<number, PlacedWord[]>();
  let skipped = 0;
  try {
    for (let n = 0; n < pages.length; n++) {
      if (useTaskProgressStore.getState().isCancelled(taskId)) break;
      const pageIndex = pages[n];
      useTaskProgressStore.getState().update(taskId, n, `Recognizing text… page ${pageIndex + 1}`);
      const page = await proxy.getPage(pageIndex + 1);
      const content = await page.getTextContent();
      if (hasRealText(content.items as { str?: string }[])) {
        skipped++;
        continue;
      }
      const unit = createPageTransform(page, { scale: 1 });
      const scale = Math.min(4, OCR_IMAGE_PX / Math.max(unit.cssWidth, unit.cssHeight));
      const transform = createPageTransform(page, { scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(transform.cssWidth);
      canvas.height = Math.round(transform.cssHeight);
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: transform.viewport }).promise;
      const lines = (await window.electronAPI.ocrRecognize!(await canvasToPng(canvas))) as OcrLine[];
      canvas.width = canvas.height = 0;
      const words = placeWords(lines, transform);
      if (words.length) found.set(pageIndex, words);
    }
    useTaskProgressStore.getState().update(taskId, pages.length, 'Adding the text layer…');

    if (found.size === 0) {
      notifyUser('info', skipped === pages.length
        ? (scope === 'page' ? 'This page already has text.' : 'Every page already has text.')
        : 'No text was found.');
      return;
    }

    const pdf = await PDFDocument.load(baseBytes);
    const fonts = await loadExportFonts();
    pdf.registerFontkit(fonts.fontkit);
    const font = await pdf.embedFont(await fonts.load('sans', 'regular'), { subset: true });
    let wordCount = 0;
    for (const [pageIndex, words] of found) wordCount += writeInvisibleText(pdf, font, pageIndex, words);
    const newBytes = await pdf.save();

    // Commit only if the document did not change meanwhile.
    const current = useDocumentStore.getState().documents.get(doc.id);
    if (!current || current.instanceId !== doc.instanceId || current.sourceData !== baseBytes) {
      notifyUser('error', 'The document changed during recognition. Please try again.');
      return;
    }
    const annotations = allAnnotations(doc.id);
    useDocumentStore.getState().updateDocument(doc.id, {
      sourceData: newBytes,
      sourceRevision: current.sourceRevision + 1,
    });
    useHistoryStore.getState().push(makeMutateDocumentBytesAction(
      doc.id, baseBytes, newBytes, annotations, annotations,
      current.pageRotations, current.pageRotations, current.pageCount, current.pageCount,
    ));
    notifyUser('success', `Recognized ${wordCount} words on ${found.size} page${found.size === 1 ? '' : 's'}. Search, text highlight and copying now work there.`);
  } catch (error) {
    notifyUser('error', `Text recognition failed: ${errorMessage(error)}`);
  } finally {
    ocrRunning = false;
    useTaskProgressStore.getState().finish(taskId);
  }
}

// ─── Handwriting → text ──────────────────────────────────────────────────────

/** Pixels per PDF point for the handwriting image. */
const INK_IMAGE_SCALE = 3;

/**
 * Convert the selected pen strokes into a text box with the recognised text.
 * One undo step brings the ink back.
 */
export async function convertInkToText(): Promise<void> {
  const doc = activeDocument();
  if (!doc) return;
  const identity = { docId: doc.id, instanceId: doc.instanceId };
  const selection = useSelectionStore.getState().getSelection(identity);
  const pageIndex = selection?.pageIndex;
  const page = pageIndex !== undefined && pageIndex !== null
    ? useAnnotationStore.getState().getPageAnnotations(doc.id, pageIndex)
    : [];
  const ink = page.filter((a) => selection?.selectedIds.includes(a.id) && a.type === 'stroke');
  if (pageIndex === undefined || pageIndex === null || ink.length === 0) {
    notifyUser('info', 'Select handwriting first (Lasso tool, S), then choose Convert Ink to Text.');
    return;
  }
  if (!(await recognitionAvailable())) return;
  const bounds = getGroupBounds(ink);
  if (!bounds) return;

  try {
    // Draw only the selected ink, black on white, for the recogniser.
    const pad = 8;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil((bounds.width + pad * 2) * INK_IMAGE_SCALE);
    canvas.height = Math.ceil((bounds.height + pad * 2) * INK_IMAGE_SCALE);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const transform = inkTransform(bounds.x - pad, bounds.y - pad, bounds.width + pad * 2, bounds.height + pad * 2, INK_IMAGE_SCALE);
    renderAnnotations(ctx, ink.map((a) => ({ ...a, color: '#000000', opacity: 1 })) as Annotation[], transform, 1);
    const lines = (await window.electronAPI.ocrRecognize!(await canvasToPng(canvas))) as OcrLine[];
    const text = lines.map((l) => l.text.trim()).filter(Boolean).join('\n');
    if (!text) {
      notifyUser('info', 'No writing was recognized in the selection.');
      return;
    }

    // Text size from the height of the recognised lines.
    const lineHeights = lines.map((l) => l.box[3] * (bounds.height + pad * 2)).filter((h) => h > 0);
    const avg = lineHeights.length ? lineHeights.reduce((a, b) => a + b, 0) / lineHeights.length : 14;
    const options = useUIStore.getState().toolOptions.text;
    const fontSize = Math.max(8, Math.min(48, Math.round(avg * 0.72)));
    const style = { ...options, fontSize, color: ink[0].color };
    const size = autoSizeTextBox({ content: text, fontSize, listStyle: style.listStyle }, canvasMeasure(style));
    const top = bounds.y + bounds.height;
    const now = Date.now();
    const textAnn: TextAnnotation = {
      id: nanoid(), pageIndex, type: 'text',
      bounds: { x: bounds.x, y: top - size.height, width: size.width, height: size.height },
      content: text,
      fontFamily: style.fontFamily, fontSize, bold: style.bold, italic: style.italic, underline: style.underline,
      align: style.align, color: style.color, backgroundColor: style.backgroundColor,
      borderColor: style.borderColor, borderWidth: style.borderWidth, listStyle: style.listStyle,
      opacity: 1, locked: false, createdAt: now, updatedAt: now,
    };

    // Replace the ink (in z-order, so undo puts each stroke back exactly).
    const store = useAnnotationStore.getState();
    const current = store.getPageAnnotations(doc.id, pageIndex);
    const doomed = new Set(ink.map((a) => a.id));
    const remaining: Annotation[] = [];
    const actions: HistoryActionDraft[] = [];
    for (const ann of current) {
      if (doomed.has(ann.id)) actions.push(makeRemoveAction(doc.id, ann, remaining.length));
      else remaining.push(ann);
    }
    store.setPageAnnotations(doc.id, pageIndex, [...remaining, textAnn]);
    actions.push(makeAddAction(doc.id, textAnn));
    useHistoryStore.getState().push(makeBatchAction(doc.id, actions));
    useSelectionStore.getState().setSelection(identity, pageIndex, [textAnn.id]);
  } catch (error) {
    notifyUser('error', `Handwriting could not be converted: ${errorMessage(error)}`);
  }
}

/** A PageTransform for an off-screen area of PDF space (no rotation, y up). */
function inkTransform(x: number, y: number, width: number, height: number, scale: number): PageTransform {
  const fakePage = {
    rotate: 0,
    view: [x, y, x + width, y + height],
    getViewport: ({ scale: s, rotation }: { scale: number; rotation?: number }) => ({
      width: width * s,
      height: height * s,
      scale: s,
      rotation: rotation ?? 0,
      transform: [s, 0, 0, -s, -x * s, (y + height) * s],
      viewBox: [x, y, x + width, y + height],
      convertToViewportPoint: (px: number, py: number) => [(px - x) * s, (y + height - py) * s],
      convertToPdfPoint: (vx: number, vy: number) => [vx / s + x, y + height - vy / s],
    }),
  };
  return createPageTransform(fakePage as unknown as Parameters<typeof createPageTransform>[0], { scale });
}
