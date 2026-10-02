/**
 * Conversions to Word (.docx):
 * - PDF ▸ Word: editable text (paragraphs with font, size, bold/italic) or
 *   each page as a picture (looks exactly like the PDF, not editable).
 *   In text mode, pages without text (scans) become pictures, or text through
 *   OCR when it is available.
 * - Pictures ▸ Word: one picture per page, or their text through OCR.
 */
import type { PDFPageProxy } from 'pdfjs-dist';
import { useDocumentStore } from '../store/documentStore';
import { useAnnotationStore } from '../store/annotationStore';
import { useTaskProgressStore } from '../store/taskProgressStore';
import { getDocumentProxy } from '../pdf/documentManager';
import { fontStyleFromName } from '../pdf/textLines';
import { renderSnapshot } from './snapshotCommands';
import { buildDocx, type DocxBlock, type DocxMargins, type DocxParagraph, type DocxSection } from '../convert/docx';
import { groupLines, linesToParagraphs, type PositionedRun, type TextLineGroup } from '../convert/textToParagraphs';
import type { DocumentIdentity } from '../types/documentSession';
import type { TextAnnotation } from '../types/annotations';
import { errorMessage, notifyUser } from '../utils/notify';

export type WordExportMode = 'text' | 'pages';

/** Pictures of pages: 150 dpi JPEG keeps text readable and files small. */
const PAGE_PICTURE_DPI = 150;
const OCR_IMAGE_PX = 2600;

interface OcrLineLike { text: string; box: [number, number, number, number] }

// ─── Fonts ───────────────────────────────────────────────────────────────────

const GENERIC_FONT = { sans: 'Arial', serif: 'Times New Roman', mono: 'Courier New' } as const;
const KNOWN_FONTS: Record<string, string> = {
  arial: 'Arial', arialmt: 'Arial', helvetica: 'Arial', helveticaneue: 'Helvetica Neue',
  timesnewroman: 'Times New Roman', timesnewromanps: 'Times New Roman', timesnewromanpsmt: 'Times New Roman', times: 'Times New Roman', timesroman: 'Times New Roman',
  couriernew: 'Courier New', couriernewpsmt: 'Courier New', courier: 'Courier New',
  calibri: 'Calibri', cambria: 'Cambria', georgia: 'Georgia', verdana: 'Verdana', tahoma: 'Tahoma',
  garamond: 'Garamond', segoeui: 'Segoe UI', trebuchetms: 'Trebuchet MS', consolas: 'Consolas',
  liberationsans: 'Arial', liberationserif: 'Times New Roman', liberationmono: 'Courier New',
  carlito: 'Calibri', caladea: 'Cambria', dejavusans: 'DejaVu Sans', dejavuserif: 'DejaVu Serif',
  roboto: 'Roboto', opensans: 'Open Sans', lato: 'Lato', poppins: 'Poppins', montserrat: 'Montserrat',
};

/** Word font name for a PDF font such as "ABCDEF+TimesNewRomanPS-BoldMT". */
export function wordFontName(pdfName: string | undefined, family: 'sans' | 'serif' | 'mono'): string {
  const base = (pdfName ?? '').replace(/^[A-Z]{6}\+/, '').split(/[-,]/)[0];
  const key = base.toLowerCase().replace(/[^a-z]/g, '').replace(/(bold|italic|oblique|regular|mt)+$/g, '');
  return KNOWN_FONTS[key] ?? KNOWN_FONTS[key.replace(/ps$/, '')] ?? GENERIC_FONT[family];
}

// ─── PDF text ────────────────────────────────────────────────────────────────

async function pageRuns(page: PDFPageProxy): Promise<PositionedRun[]> {
  const content = await page.getTextContent();
  // Real font names (for bold/italic) are known once the page's fonts are loaded.
  try { await page.getOperatorList(); } catch { /* generic names are enough */ }
  const styles = content.styles as Record<string, { fontFamily?: string }>;
  const fontCache = new Map<string, { bold: boolean; italic: boolean; font: string }>();
  const fontFor = (fontName: string) => {
    let style = fontCache.get(fontName);
    if (!style) {
      let realName: string | undefined;
      try {
        if (page.commonObjs.has(fontName)) realName = (page.commonObjs.get(fontName) as { name?: string })?.name;
      } catch { realName = undefined; }
      const guess = fontStyleFromName(realName ?? fontName, styles[fontName]?.fontFamily);
      style = { bold: guess.bold, italic: guess.italic, font: wordFontName(realName, guess.family) };
      fontCache.set(fontName, style);
    }
    return style;
  };
  const runs: PositionedRun[] = [];
  for (const item of content.items) {
    if (!('str' in item) || !item.str) continue;
    const [a, b, c, d, e, f] = item.transform as number[];
    const size = Math.hypot(c, d) || Math.hypot(a, b);
    // Rotated text keeps its words but not its direction.
    runs.push({ text: item.str, x: e, y: f, width: item.width, size, ...fontFor(item.fontName) });
  }
  return runs;
}

/** User text boxes on the page, as lines (they are part of the work). */
function annotationRuns(docId: string, pageIndex: number): PositionedRun[] {
  const annotations = useAnnotationStore.getState().getPageAnnotations(docId, pageIndex)
    .filter((a): a is TextAnnotation => a.type === 'text' && !a.hidden && !!a.content.trim())
    .sort((p, q) => (q.bounds.y + q.bounds.height) - (p.bounds.y + p.bounds.height));
  const runs: PositionedRun[] = [];
  for (const a of annotations) {
    const family = /mono|courier/i.test(a.fontFamily) ? 'mono' : /serif|times|caladea|cambria/i.test(a.fontFamily.replace(/sans-serif/gi, '')) ? 'serif' : 'sans';
    a.content.split('\n').forEach((text, i) => {
      runs.push({
        text: text || ' ',
        x: a.bounds.x + 4,
        y: a.bounds.y + a.bounds.height - 4 - a.fontSize * (i + 1) * 1.2 + a.fontSize * 0.2,
        width: text.length * a.fontSize * 0.5,
        size: a.fontSize,
        bold: a.bold,
        italic: a.italic,
        font: GENERIC_FONT[family],
      });
    });
  }
  return runs;
}

function ocrRuns(lines: readonly OcrLineLike[], width: number, height: number): PositionedRun[] {
  return lines.filter((l) => l.text.trim()).map((line) => {
    const [x, y, w, h] = line.box;
    const size = Math.max(4, h * height * 0.78);
    return { text: line.text.trim(), x: x * width, y: height - (y + h) * height + h * height * 0.2, width: w * width, size, font: 'Arial' };
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function canvasBytes(canvas: HTMLCanvasElement, type: 'image/jpeg' | 'image/png', quality?: number): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  if (!blob) throw new Error('Could not make the page picture.');
  return new Uint8Array(await blob.arrayBuffer());
}

async function ocrAvailable(): Promise<boolean> {
  const api = window.electronAPI;
  if (!api?.ocrRecognize || !api.ocrIsAvailable) return false;
  try { return await api.ocrIsAvailable(); } catch { return false; }
}

/** Margins that keep the PDF's text where it was (clamped to sensible values). */
function marginsFor(lines: readonly TextLineGroup[], width: number, height: number): DocxMargins {
  if (lines.length === 0) return { top: 56, right: 56, bottom: 56, left: 56 };
  const left = Math.min(...lines.map((l) => l.x));
  const right = width - Math.max(...lines.map((l) => l.right));
  const top = height - Math.max(...lines.map((l) => l.y + l.size));
  const clamp = (v: number) => Math.round(Math.max(28, Math.min(108, v)));
  return { top: clamp(top - 4), right: clamp(Math.min(right, left + 36)), bottom: 42, left: clamp(left) };
}

async function pagePicture(identity: DocumentIdentity, pageIndex: number, rotation: number, pageBreakBefore: boolean): Promise<{ block: DocxBlock; width: number; height: number }> {
  const scale = PAGE_PICTURE_DPI / 72;
  const canvas = await renderSnapshot(identity, pageIndex, null, rotation, scale);
  const width = canvas.width / scale;
  const height = canvas.height / scale;
  const data = await canvasBytes(canvas, 'image/jpeg', 0.88);
  canvas.width = canvas.height = 0;
  // A hair smaller than the page so Word never pushes it to a new page.
  return { block: { kind: 'image', data, mimeType: 'image/jpeg', widthPt: width - 0.5, heightPt: height - 0.5, pageBreakBefore }, width, height };
}

async function ocrPage(page: PDFPageProxy): Promise<OcrLineLike[]> {
  const viewport = page.getViewport({ scale: 1 });
  const scale = OCR_IMAGE_PX / Math.max(viewport.width, viewport.height);
  const scaled = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(scaled.width);
  canvas.height = Math.round(scaled.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: scaled }).promise;
  const png = await canvasBytes(canvas, 'image/png');
  canvas.width = canvas.height = 0;
  return (await window.electronAPI.ocrRecognize!(png.buffer as ArrayBuffer)) as OcrLineLike[];
}

async function saveDocx(bytes: Uint8Array, suggestedName: string): Promise<boolean> {
  const api = window.electronAPI;
  if (!api?.saveFile || !api.writeFile) throw new Error('Saving needs the desktop app.');
  const path = await api.saveFile(suggestedName, 'docx');
  if (!path) return false;
  await api.writeFile(path, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  return true;
}

// ─── PDF ▸ Word ──────────────────────────────────────────────────────────────

/** Build the Word file for the active document (no saving). */
export async function buildWordFromDocument(mode: WordExportMode, onPage?: (done: number, total: number) => boolean): Promise<{ bytes: Uint8Array; title: string } | null> {
  const store = useDocumentStore.getState();
  const doc = store.activeDocId ? store.documents.get(store.activeDocId) : null;
  if (!doc) return null;
  const identity = { docId: doc.id, instanceId: doc.instanceId };
  const proxy = getDocumentProxy(identity);
  if (!proxy) throw new Error('The document is not open.');
  const useOcr = mode === 'text' && await ocrAvailable();

  const sections: DocxSection[] = [];
  let textSection: DocxSection | null = null;
  for (let pageIndex = 0; pageIndex < doc.pageCount; pageIndex++) {
    if (onPage && !onPage(pageIndex, doc.pageCount)) return null;
    const rotation = doc.pageRotations[pageIndex] ?? 0;
    const page = await proxy.getPage(pageIndex + 1);

    if (mode === 'pages') {
      const picture = await pagePicture(identity, pageIndex, rotation, false);
      sections.push({ pageWidthPt: picture.width, pageHeightPt: picture.height, margins: { top: 0, right: 0, bottom: 0, left: 0 }, blocks: [picture.block] });
      continue;
    }

    // Text mode. Rotated pages keep their text; positions use the unrotated page.
    const view = { width: page.view[2] - page.view[0], height: page.view[3] - page.view[1] };
    let runs = (await pageRuns(page)).map((r) => ({ ...r, x: r.x - page.view[0], y: r.y - page.view[1] }));
    if (runs.every((r) => !r.text.trim()) && useOcr) {
      try { runs = ocrRuns(await ocrPage(page), view.width, view.height); } catch { runs = []; }
    }
    runs.push(...annotationRuns(doc.id, pageIndex).map((r) => ({ ...r, x: r.x - page.view[0], y: r.y - page.view[1] })));
    const lines = groupLines(runs);

    if (lines.length === 0) {
      // A picture-only page (scan without OCR, drawing…): keep it as a picture.
      const picture = await pagePicture(identity, pageIndex, rotation, false);
      textSection = null;
      sections.push({ pageWidthPt: picture.width, pageHeightPt: picture.height, margins: { top: 0, right: 0, bottom: 0, left: 0 }, blocks: [picture.block] });
      continue;
    }

    // Text flows on the unrotated page (its positions are in that space).
    const sameSize = textSection && Math.abs(textSection.pageWidthPt - view.width) < 1 && Math.abs(textSection.pageHeightPt - view.height) < 1;
    if (!textSection || !sameSize) {
      textSection = { pageWidthPt: view.width, pageHeightPt: view.height, margins: marginsFor(lines, view.width, view.height), blocks: [] };
      sections.push(textSection);
    }
    const m = textSection.margins;
    const paragraphs: DocxParagraph[] = linesToParagraphs(lines, {
      marginLeft: m.left, marginRight: m.right, marginTop: m.top, pageWidth: view.width, pageHeight: view.height,
    });
    // Each PDF page starts a new Word page.
    if (textSection.blocks.length > 0 && paragraphs.length > 0) paragraphs[0] = { ...paragraphs[0], pageBreakBefore: true };
    textSection.blocks.push(...paragraphs);
  }
  onPage?.(doc.pageCount, doc.pageCount);
  return { bytes: buildDocx(sections, { title: doc.title.replace(/\.pdf$/i, '') }), title: doc.title };
}

/** PDF ▸ Export to Word… */
export async function exportToWord(mode: WordExportMode): Promise<boolean> {
  const store = useDocumentStore.getState();
  const doc = store.activeDocId ? store.documents.get(store.activeDocId) : null;
  if (!doc) return false;
  const progress = useTaskProgressStore.getState();
  const taskId = progress.start('Exporting to Word…', doc.pageCount);
  try {
    const result = await buildWordFromDocument(mode, (done, total) => {
      useTaskProgressStore.getState().update(taskId, done, `Exporting to Word… page ${Math.min(done + 1, total)}`);
      return !useTaskProgressStore.getState().isCancelled(taskId);
    });
    useTaskProgressStore.getState().finish(taskId);
    if (!result) return false;
    const saved = await saveDocx(result.bytes, result.title.replace(/\.pdf$/i, '') + '.docx');
    if (saved) notifyUser('success', 'Word document saved.');
    return saved;
  } catch (error) {
    notifyUser('error', `The Word file could not be made: ${errorMessage(error)}`);
    return false;
  } finally {
    useTaskProgressStore.getState().finish(taskId);
  }
}

// ─── Pictures ▸ Word ─────────────────────────────────────────────────────────

export interface WordPicture {
  name: string;
  mimeType: string;
  width: number;
  height: number;
  data: Uint8Array;
}

const A4 = { width: 595.28, height: 841.89 };
const PICTURE_MARGIN = 42;

async function pictureAsJpegOrPng(picture: WordPicture): Promise<{ data: Uint8Array; mimeType: 'image/png' | 'image/jpeg' }> {
  if (picture.mimeType === 'image/png' || picture.mimeType === 'image/jpeg') return { data: picture.data, mimeType: picture.mimeType };
  // WebP and others: Word wants PNG or JPEG.
  const bitmap = await createImageBitmap(new Blob([picture.data as BlobPart], { type: picture.mimeType }));
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  bitmap.close();
  const data = await canvasBytes(canvas, 'image/png');
  canvas.width = canvas.height = 0;
  return { data, mimeType: 'image/png' };
}

async function ocrPicture(picture: { data: Uint8Array; mimeType: string }): Promise<OcrLineLike[]> {
  const bitmap = await createImageBitmap(new Blob([picture.data as BlobPart], { type: picture.mimeType }));
  const scale = Math.min(1, OCR_IMAGE_PX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const png = await canvasBytes(canvas, 'image/png');
  canvas.width = canvas.height = 0;
  return (await window.electronAPI.ocrRecognize!(png.buffer as ArrayBuffer)) as OcrLineLike[];
}

/** Word file from pictures: each on its own A4 page, or their recognised text. */
export async function buildWordFromPictures(pictures: readonly WordPicture[], withText: boolean, onPicture?: (done: number) => boolean): Promise<Uint8Array | null> {
  const blocks: DocxBlock[] = [];
  const innerW = A4.width - PICTURE_MARGIN * 2;
  const innerH = A4.height - PICTURE_MARGIN * 2 - 2;
  for (let i = 0; i < pictures.length; i++) {
    if (onPicture && !onPicture(i)) return null;
    const picture = pictures[i];
    const breakBefore = blocks.length > 0;
    if (withText) {
      const lines = await ocrPicture(picture);
      // Lay the text out on a page of the picture's proportions, A4 wide.
      const width = A4.width;
      const height = (picture.height / Math.max(1, picture.width)) * width;
      const groups = groupLines(ocrRuns(lines, width, height));
      const paragraphs: DocxParagraph[] = linesToParagraphs(groups, { marginLeft: PICTURE_MARGIN, marginRight: PICTURE_MARGIN, marginTop: PICTURE_MARGIN, pageWidth: width, pageHeight: height })
        .map((p, index) => ({ ...p, spaceBefore: index === 0 ? undefined : p.spaceBefore }));
      if (paragraphs.length === 0) paragraphs.push({ kind: 'paragraph', runs: [] });
      paragraphs[0] = { ...paragraphs[0], pageBreakBefore: breakBefore };
      blocks.push(...paragraphs);
    } else {
      const scale = Math.min(innerW / picture.width, innerH / picture.height, 1);
      const image = await pictureAsJpegOrPng(picture);
      blocks.push({
        kind: 'image', ...image, align: 'center',
        widthPt: Math.max(1, picture.width * scale), heightPt: Math.max(1, picture.height * scale),
        pageBreakBefore: breakBefore,
      });
    }
  }
  onPicture?.(pictures.length);
  return buildDocx([{ pageWidthPt: A4.width, pageHeightPt: A4.height, margins: { top: PICTURE_MARGIN, right: PICTURE_MARGIN, bottom: PICTURE_MARGIN, left: PICTURE_MARGIN }, blocks }]);
}

/** Pictures ▸ Word: build and save. */
export async function exportPicturesToWord(pictures: readonly WordPicture[], withText: boolean): Promise<boolean> {
  if (pictures.length === 0) return false;
  if (withText && !(await ocrAvailable())) {
    notifyUser('error', 'Text recognition needs the MaliPDF desktop app on macOS.');
    return false;
  }
  const taskId = useTaskProgressStore.getState().start('Making the Word file…', pictures.length);
  try {
    const bytes = await buildWordFromPictures(pictures, withText, (done) => {
      useTaskProgressStore.getState().update(taskId, done);
      return !useTaskProgressStore.getState().isCancelled(taskId);
    });
    useTaskProgressStore.getState().finish(taskId);
    if (!bytes) return false;
    const base = pictures.length === 1 ? pictures[0].name.replace(/\.[^.]+$/, '') : 'Pictures';
    const saved = await saveDocx(bytes, `${base}.docx`);
    if (saved) notifyUser('success', 'Word document saved.');
    return saved;
  } catch (error) {
    notifyUser('error', `The Word file could not be made: ${errorMessage(error)}`);
    return false;
  } finally {
    useTaskProgressStore.getState().finish(taskId);
  }
}

export { ocrAvailable as wordOcrAvailable };
