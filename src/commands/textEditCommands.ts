/**
 * Edit PDF Text: find the line under a click (font, size, colours) and turn
 * a change into a textEdit annotation (one undo step).
 */
import { getDocumentProxy } from '../pdf/documentManager';
import { createPageTransform, pdfRectToScreenBounds } from '../pdf/coordinateTransform';
import { buildLines, fontStyleFromName, lineAt, type TextLine } from '../pdf/textLines';
import { coverQuad } from '../pdf/textEdit';
import { cssForFamily } from '../pdf/fontFamilies';
import { cssFont, matchPdfText } from '../pdf/textLayout';
import { useAnnotationStore } from '../store/annotationStore';
import { useHistoryStore, makeAddAction, makeUpdateAction, makeRemoveAction } from '../store/historyStore';
import type { PdfPoint, TextEditAnnotation } from '../types/annotations';
import type { DocumentIdentity } from '../types/documentSession';
import { nanoid } from '../utils/nanoid';

export interface EditableLine {
  line: TextLine;
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  color: string;
  background: string;
}

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/**
 * Background = the most common colour around the line; text colour = the
 * pixels that differ most from it.
 */
export function sampleColors(data: Uint8ClampedArray, width: number, height: number): { color: string; background: string } {
  const counts = new Map<number, number>();
  const key = (i: number) => ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
  const edge = (x: number, y: number) => x < 2 || y < 2 || x >= width - 2 || y >= height - 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!edge(x, y)) continue;
      const k = key((y * width + x) * 4);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  let bgKey = 0xfff;
  let best = -1;
  for (const [k, n] of counts) if (n > best) { best = n; bgKey = k; }
  // Average the real pixels of the background bucket.
  let br = 0, bg = 0, bb = 0, bn = 0;
  const far: [number, number][] = [];
  for (let i = 0; i < data.length; i += 4) {
    if (key(i) === bgKey) { br += data[i]; bg += data[i + 1]; bb += data[i + 2]; bn++; }
  }
  const back = bn ? [br / bn, bg / bn, bb / bn] : [255, 255, 255];
  for (let i = 0; i < data.length; i += 4) {
    const d = Math.abs(data[i] - back[0]) + Math.abs(data[i + 1] - back[1]) + Math.abs(data[i + 2] - back[2]);
    if (d > 60) far.push([d, i]);
  }
  far.sort((a, b) => b[0] - a[0]);
  const top = far.slice(0, Math.max(1, Math.floor(far.length * 0.3)));
  let cr = 0, cg = 0, cb = 0;
  for (const [, i] of top) { cr += data[i]; cg += data[i + 1]; cb += data[i + 2]; }
  const color = far.length ? hex(cr / top.length, cg / top.length, cb / top.length) : '#000000';
  return { color, background: hex(back[0], back[1], back[2]) };
}

/** The PDF text line at `p`, with its look, or null. */
export async function findEditableLine(identity: DocumentIdentity, pageIndex: number, p: PdfPoint, rotation = 0): Promise<EditableLine | null> {
  const proxy = getDocumentProxy(identity);
  if (!proxy) return null;
  const page = await proxy.getPage(pageIndex + 1);
  const content = await page.getTextContent();
  const runs = content.items.flatMap((item) => ('str' in item
    ? [{ str: item.str, transform: item.transform as number[], width: item.width, fontName: item.fontName }]
    : []));
  const line = lineAt(buildLines(runs), p);
  if (!line) return null;

  // Font: the real PDF font name when pdf.js has loaded it, else the generic family.
  const styleFamily = line.fontName ? (content.styles as Record<string, { fontFamily?: string }>)[line.fontName]?.fontFamily : undefined;
  let realName: string | undefined;
  try {
    if (line.fontName && page.commonObjs.has(line.fontName)) realName = (page.commonObjs.get(line.fontName) as { name?: string })?.name;
  } catch {
    realName = undefined;
  }
  const style = fontStyleFromName(realName ?? line.fontName, styleFamily);

  // Colours from a small render of the line.
  let colors = { color: '#000000', background: '#ffffff' };
  try {
    const scale = 3;
    const transform = createPageTransform(page, { scale, displayRotation: rotation });
    const quad = coverQuad({ origin: line.origin, angle: line.angle, ascent: line.ascent, descent: line.descent }, line.width, 3);
    const xs = quad.map((q) => q.x), ys = quad.map((q) => q.y);
    const box = pdfRectToScreenBounds({ x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }, transform);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(4, Math.min(3000, Math.round(box.width)));
    canvas.height = Math.max(4, Math.min(600, Math.round(box.height)));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: transform.viewport, transform: [1, 0, 0, 1, -box.x, -box.y] }).promise;
      colors = sampleColors(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
    }
    canvas.width = canvas.height = 0;
  } catch {
    // keep black on white
  }
  return { line, fontFamily: cssForFamily(style.family), bold: style.bold, italic: style.italic, ...colors };
}

let measureCtx: CanvasRenderingContext2D | null = null;
export function measureEditText(text: string, a: Pick<TextEditAnnotation, 'fontSize' | 'fontFamily' | 'bold' | 'italic'>): number {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  if (!measureCtx) return text.length * a.fontSize * 0.52;
  measureCtx.font = cssFont(a);
  matchPdfText(measureCtx);
  return measureCtx.measureText(text).width;
}

/** A new edit from a found line (not stored yet). */
export function makeTextEdit(pageIndex: number, found: EditableLine, text: string): TextEditAnnotation {
  const now = Date.now();
  const base = {
    fontSize: Math.round(found.line.fontSize * 100) / 100,
    fontFamily: found.fontFamily, bold: found.bold, italic: found.italic,
  };
  return {
    id: nanoid(), pageIndex, type: 'textEdit',
    origin: { ...found.line.origin }, angle: found.line.angle,
    originalWidth: found.line.width, ascent: found.line.ascent, descent: found.line.descent,
    original: found.line.text, text, textWidth: measureEditText(text, base), ...base,
    color: found.color, background: found.background, opacity: 1,
    locked: false, createdAt: now, updatedAt: now,
  };
}

/** Store a new or changed edit as one undo step. `before` null = new. */
export function commitTextEdit(docId: string, before: TextEditAnnotation | null, after: TextEditAnnotation): void {
  const store = useAnnotationStore.getState();
  const history = useHistoryStore.getState();
  if (!before) {
    if (after.text === after.original) return;
    store.addAnnotation(docId, after);
    history.push(makeAddAction(docId, after));
    return;
  }
  if (after.text === before.text) return;
  if (after.text === after.original) {
    // Back to the original wording: the edit is no longer needed.
    const index = store.getPageAnnotations(docId, before.pageIndex).findIndex((a) => a.id === before.id);
    store.removeAnnotation(docId, before.pageIndex, before.id);
    history.push(makeRemoveAction(docId, before, index));
    return;
  }
  const next = { ...after, textWidth: measureEditText(after.text, after), updatedAt: Date.now() };
  store.replaceAnnotation(docId, before.pageIndex, next);
  history.push(makeUpdateAction(docId, before, next));
}
