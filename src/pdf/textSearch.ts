/**
 * Text search over pdf.js text content (the PDF's text layer — scanned pages
 * without OCR have no text and simply produce no results).
 *
 * Matching is case- and diacritic-insensitive ("sehir" finds "Şehir", "i"
 * finds "İ" and "ı"), whitespace runs match a single space. Match rectangles
 * are computed in PDF user space, the same space as annotations, so they are
 * drawn with the page's PageTransform.
 */
import type { PdfRect } from '../types/annotations';

export interface SearchTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
}

interface CharRef {
  item: number;
  char: number; // index into item.str; -1 for synthetic separators
}

export interface PageTextIndex {
  /** Normalized, searchable text of the page. */
  text: string;
  /** For each char of `text`, where it came from. */
  refs: CharRef[];
  items: SearchTextItem[];
}

export interface PageMatch {
  pageIndex: number;
  /** Rectangles (one per text item touched) in PDF user space. */
  rects: PdfRect[];
  /** Surrounding text for the results list. */
  snippet: string;
}

const MARKS = /\p{M}/gu;

/** Normalize one character to zero or more comparable characters. */
function foldChar(ch: string): string {
  if (/\s/.test(ch)) return ' ';
  if (ch === 'ı' || ch === 'İ') return 'i';
  return ch.normalize('NFKD').replace(MARKS, '').toLowerCase();
}

export function normalizeQuery(query: string): string {
  let out = '';
  for (const ch of query) {
    const folded = foldChar(ch);
    if (folded === ' ' && (out === '' || out.endsWith(' '))) continue;
    out += folded;
  }
  return out.trim();
}

export function buildPageTextIndex(items: SearchTextItem[]): PageTextIndex {
  let text = '';
  const refs: CharRef[] = [];
  const push = (value: string, ref: CharRef) => {
    for (const ch of value) {
      if (ch === ' ' && (text === '' || text.endsWith(' '))) continue;
      text += ch;
      refs.push(ref);
    }
  };
  items.forEach((item, itemIndex) => {
    let char = 0;
    for (const ch of item.str) {
      push(foldChar(ch), { item: itemIndex, char });
      char += ch.length;
    }
    if (item.hasEOL) push(' ', { item: itemIndex, char: -1 });
  });
  return { text, refs, items };
}

export function findMatchesInPage(index: PageTextIndex, query: string, pageIndex: number): PageMatch[] {
  const needle = normalizeQuery(query);
  if (!needle) return [];
  const matches: PageMatch[] = [];
  let from = 0;
  for (;;) {
    const start = index.text.indexOf(needle, from);
    if (start < 0) break;
    const end = start + needle.length; // exclusive
    matches.push({
      pageIndex,
      rects: rectsForRange(index, start, end),
      snippet: snippetFor(index, start, end),
    });
    from = end;
  }
  return matches;
}

function rectsForRange(index: PageTextIndex, start: number, end: number): PdfRect[] {
  // Group the matched characters by text item → [minChar, maxChar] per item.
  const spans = new Map<number, { min: number; max: number }>();
  for (let i = start; i < end; i++) {
    const ref = index.refs[i];
    if (!ref || ref.char < 0) continue;
    const span = spans.get(ref.item);
    if (span) { span.min = Math.min(span.min, ref.char); span.max = Math.max(span.max, ref.char); }
    else spans.set(ref.item, { min: ref.char, max: ref.char });
  }
  const rects: PdfRect[] = [];
  for (const [itemIndex, span] of spans) {
    const item = index.items[itemIndex];
    const length = Math.max(1, item.str.length);
    rects.push(itemRect(item, span.min / length, (span.max + 1) / length));
  }
  return rects;
}

function itemRect(item: SearchTextItem, fromFraction: number, toFraction: number): PdfRect {
  const [a, b, c, d, e, f] = item.transform;
  const baseLength = Math.hypot(a, b) || 1;
  const dir = { x: a / baseLength, y: b / baseLength };
  const fontHeight = Math.hypot(c, d) || item.height || 10;
  const up = { x: -dir.y, y: dir.x };
  const descent = fontHeight * 0.22;
  const ascent = fontHeight * 0.9;
  const startAlong = item.width * fromFraction;
  const endAlong = item.width * toFraction;
  const corners = [startAlong, endAlong].flatMap((along) => [-descent, ascent].map((offset) => ({
    x: e + dir.x * along + up.x * offset,
    y: f + dir.y * along + up.y * offset,
  })));
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function snippetFor(index: PageTextIndex, start: number, end: number): string {
  const before = index.text.slice(Math.max(0, start - 24), start);
  const after = index.text.slice(end, end + 36);
  const original = originalText(index, start, end);
  return `${start > 24 ? '…' : ''}${before}${original}${after}${end + 36 < index.text.length ? '…' : ''}`.trim();
}

/** The matched text as written in the PDF (case/diacritics preserved). */
function originalText(index: PageTextIndex, start: number, end: number): string {
  let out = '';
  let last: CharRef | null = null;
  for (let i = start; i < end; i++) {
    const ref = index.refs[i];
    if (!ref) continue;
    if (ref.char < 0) { out += ' '; last = null; continue; }
    if (last && last.item === ref.item && last.char === ref.char) continue;
    out += index.items[ref.item].str.slice(ref.char, ref.char + 1);
    last = ref;
  }
  return out;
}
