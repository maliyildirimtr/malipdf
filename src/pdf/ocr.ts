/**
 * OCR support: turn recognised words (macOS Vision, see electron/services/ocr)
 * into an invisible text layer in the PDF — the standard "searchable PDF".
 * The page looks exactly the same, but search, text highlight / underline,
 * copying and other PDF apps can now find the text.
 */
import {
  PDFDocument,
  TextRenderingMode,
  beginText,
  endText,
  popGraphicsState,
  pushGraphicsState,
  setCharacterSqueeze,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  showText,
  type PDFFont,
} from 'pdf-lib';
import type { PdfPoint } from '../types/annotations';
import { screenToPdf, type PageTransform } from './coordinateTransform';

export interface OcrWord { text: string; box: [number, number, number, number] }
export interface OcrLine { text: string; confidence: number; box: [number, number, number, number]; words: OcrWord[] }

/** A recognised word placed on the page: baseline start, direction and size in PDF space. */
export interface PlacedWord {
  text: string;
  /** Bottom-left, bottom-right, top-left corners in PDF user space. */
  bl: PdfPoint;
  br: PdfPoint;
  tl: PdfPoint;
}

/**
 * Map Vision's word boxes (normalised, top-left origin, on the image that was
 * rendered with `transform`) to PDF user space.
 */
export function placeWords(lines: readonly OcrLine[], transform: PageTransform): PlacedWord[] {
  const w = transform.cssWidth;
  const h = transform.cssHeight;
  const out: PlacedWord[] = [];
  for (const line of lines) {
    const words = line.words.length ? line.words : [{ text: line.text, box: line.box }];
    for (const word of words) {
      const text = word.text.trim();
      if (!text) continue;
      const [x, y, bw, bh] = word.box;
      if (![x, y, bw, bh].every(Number.isFinite) || bw <= 0 || bh <= 0) continue;
      const left = x * w;
      const top = y * h;
      const right = (x + bw) * w;
      const bottom = (y + bh) * h;
      out.push({
        text,
        bl: screenToPdf(left, bottom, transform),
        br: screenToPdf(right, bottom, transform),
        tl: screenToPdf(left, top, transform),
      });
    }
  }
  return out;
}

/** Fraction of the box height below the baseline (Latin text). */
const DESCENT = 0.21;

/**
 * Write `words` as invisible text (render mode 3) on page `pageIndex`, each
 * word stretched to its box so selections line up with the picture.
 */
export function writeInvisibleText(doc: PDFDocument, font: PDFFont, pageIndex: number, words: readonly PlacedWord[]): number {
  if (words.length === 0) return 0;
  const page = doc.getPage(pageIndex);
  const fontKey = page.node.newFontDictionary(font.name, font.ref);
  const ops = [pushGraphicsState(), beginText(), setTextRenderingMode(TextRenderingMode.Invisible)];
  let written = 0;
  for (const word of words) {
    const dx = word.br.x - word.bl.x;
    const dy = word.br.y - word.bl.y;
    const width = Math.hypot(dx, dy);
    const height = Math.hypot(word.tl.x - word.bl.x, word.tl.y - word.bl.y);
    if (!(width > 0.5 && height > 0.5)) continue;
    const size = height;
    let encoded;
    let natural;
    try {
      encoded = font.encodeText(word.text);
      natural = font.widthOfTextAtSize(word.text, size);
    } catch {
      continue;
    }
    if (!(natural > 0)) continue;
    const squeeze = Math.max(1, Math.min(1000, (width / natural) * 100));
    const cos = dx / width;
    const sin = dy / width;
    // Baseline: a little above the bottom of the box.
    const up = { x: (word.tl.x - word.bl.x) / height, y: (word.tl.y - word.bl.y) / height };
    const ox = word.bl.x + up.x * height * DESCENT;
    const oy = word.bl.y + up.y * height * DESCENT;
    ops.push(
      setFontAndSize(fontKey, round(size)),
      setCharacterSqueeze(round(squeeze)),
      setTextMatrix(round(cos), round(sin), round(-sin), round(cos), round(ox), round(oy)),
      showText(encoded),
    );
    written++;
  }
  ops.push(endText(), popGraphicsState());
  if (written) page.pushOperators(...ops);
  return written;
}

const round = (value: number) => Math.round(value * 1000) / 1000;

/** True when the text items of a page contain real text (not just spaces). */
export function hasRealText(items: readonly { str?: string }[]): boolean {
  return items.some((item) => typeof item.str === 'string' && /\S/.test(item.str));
}
