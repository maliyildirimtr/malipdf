/**
 * Text selection on the PDF's text layer (pdf.js text content), for the
 * Text Highlight / Underline / Strikethrough tool.
 *
 * pdf.js gives one item per text run with its transform and total advance
 * width, but no per-glyph positions. Glyph positions are estimated from the
 * item width, split by measured character widths when a canvas is available
 * (proportional fonts), else evenly. A drag selects letter by letter, like
 * in a text editor; a plain click selects the word under it.
 *
 * Everything is in PDF user space, like annotations.
 */
import type { PdfPoint } from '../types/annotations';
import type { SearchTextItem } from './textSearch';
import type { InkShape, PathCommand } from './inkGeometry';

/** Four corners in PDF user space: bottom-left, bottom-right, top-right, top-left. */
export type Quad = [PdfPoint, PdfPoint, PdfPoint, PdfPoint];

interface Glyph {
  item: number;
  char: number;          // index into item.str
  from: number;          // advance along the baseline from the item origin
  to: number;
  isSpace: boolean;
}

export interface PageTextLayout {
  items: SearchTextItem[];
  glyphs: Glyph[];
}

type MeasureFn = (text: string, fontFamily?: string) => number;

let sharedMeasure: MeasureFn | null | undefined;

function defaultMeasure(): MeasureFn | null {
  if (sharedMeasure !== undefined) return sharedMeasure;
  sharedMeasure = null;
  try {
    const canvas = typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(1, 1)
      : typeof document !== 'undefined' ? document.createElement('canvas') : null;
    const ctx = canvas?.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null | undefined;
    if (ctx && typeof ctx.measureText === 'function') {
      ctx.font = '100px sans-serif';
      const probe = ctx.measureText('abc').width;
      let current = 'sans-serif';
      // Measure in the PDF font's family (serif / sans / monospace), so the
      // letter edges of a highlight land close to the real ones.
      if (probe > 0) sharedMeasure = (text: string, fontFamily = 'sans-serif') => {
        if (fontFamily !== current) {
          current = fontFamily;
          ctx.font = `100px ${/^[\w\s-]+$/.test(fontFamily) ? fontFamily : 'sans-serif'}, sans-serif`;
        }
        return ctx.measureText(text).width;
      };
    }
  } catch {
    sharedMeasure = null;
  }
  return sharedMeasure;
}

export function buildTextLayout(items: SearchTextItem[], measure: MeasureFn | null = defaultMeasure()): PageTextLayout {
  const glyphs: Glyph[] = [];
  items.forEach((item, itemIndex) => {
    const chars = Array.from(item.str);
    if (chars.length === 0 || !(item.width > 0)) return;
    // Prefix advances of each character, scaled to the item's real width.
    const widths = chars.map((ch) => (measure ? Math.max(0, measure(ch, item.fontFamily)) : 1));
    const total = widths.reduce((a, b) => a + b, 0);
    const scale = total > 0 ? item.width / total : 0;
    let along = 0;
    let char = 0;
    chars.forEach((ch, i) => {
      const w = total > 0 ? widths[i] * scale : item.width / chars.length;
      glyphs.push({ item: itemIndex, char, from: along, to: along + w, isSpace: /\s/.test(ch) });
      along += w;
      char += ch.length;
    });
  });
  return { items, glyphs };
}

interface ItemFrame {
  origin: PdfPoint;
  dir: PdfPoint;
  up: PdfPoint;
  ascent: number;
  descent: number;
}

function frameOf(item: SearchTextItem): ItemFrame {
  const [a, b, c, d, e, f] = item.transform;
  const base = Math.hypot(a, b) || 1;
  const dir = { x: a / base, y: b / base };
  const fontHeight = Math.hypot(c, d) || item.height || 10;
  return { origin: { x: e, y: f }, dir, up: { x: -dir.y, y: dir.x }, ascent: fontHeight * 0.9, descent: fontHeight * 0.22 };
}

function quadFor(frame: ItemFrame, from: number, to: number): Quad {
  const at = (along: number, offset: number): PdfPoint => ({
    x: frame.origin.x + frame.dir.x * along + frame.up.x * offset,
    y: frame.origin.y + frame.dir.y * along + frame.up.y * offset,
  });
  return [at(from, -frame.descent), at(to, -frame.descent), at(to, frame.ascent), at(from, frame.ascent)];
}

/** Local (along, offset) coordinates of `p` in an item's frame. */
function localPoint(frame: ItemFrame, p: PdfPoint) {
  const dx = p.x - frame.origin.x;
  const dy = p.y - frame.origin.y;
  return { along: dx * frame.dir.x + dy * frame.dir.y, offset: dx * frame.up.x + dy * frame.up.y };
}

/**
 * Index of the glyph at (or nearest to) `p`, or -1 when no text is within
 * `maxDistance` points.
 */
export function glyphAt(layout: PageTextLayout, p: PdfPoint, maxDistance = 12): number {
  let best = -1;
  let bestScore = Infinity;
  const frames = new Map<number, ItemFrame>();
  layout.glyphs.forEach((g, i) => {
    let frame = frames.get(g.item);
    if (!frame) {
      frame = frameOf(layout.items[g.item]);
      frames.set(g.item, frame);
    }
    const local = localPoint(frame, p);
    const dx = local.along < g.from ? g.from - local.along : local.along > g.to ? local.along - g.to : 0;
    const dy = local.offset < -frame.descent ? -frame.descent - local.offset : local.offset > frame.ascent ? local.offset - frame.ascent : 0;
    // Distance across lines counts more than along a line.
    const score = Math.hypot(dx, dy * 2) + (g.isSpace ? 0.01 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return bestScore <= maxDistance ? best : -1;
}

/**
 * Caret position for a point: the boundary before glyph k, as in a text
 * editor. A point on the right half of a glyph puts the caret after it.
 * -1 when no text is within `maxDistance`.
 */
export function caretAt(layout: PageTextLayout, p: PdfPoint, maxDistance = 12): number {
  const index = glyphAt(layout, p, maxDistance);
  if (index < 0) return -1;
  const glyph = layout.glyphs[index];
  const local = localPoint(frameOf(layout.items[glyph.item]), p);
  return local.along > (glyph.from + glyph.to) / 2 ? index + 1 : index;
}

/** Below this drag distance (points) the tool takes it as a click on a word. */
const CLICK_DISTANCE = 1.5;

/** Expand [start, end] (glyph indices, inclusive) to whole words. */
function snapToWords(layout: PageTextLayout, start: number, end: number): [number, number] {
  const { glyphs } = layout;
  const sameWord = (a: number, b: number) =>
    glyphs[a] && glyphs[b] && glyphs[a].item === glyphs[b].item && !glyphs[a].isSpace && !glyphs[b].isSpace;
  let s = start;
  let e = end;
  while (s > 0 && sameWord(s - 1, s)) s--;
  while (e < glyphs.length - 1 && sameWord(e, e + 1)) e++;
  // Trim spaces at the ends.
  while (s < e && glyphs[s].isSpace) s++;
  while (e > s && glyphs[e].isSpace) e--;
  return [s, e];
}

export interface TextSelection {
  quads: Quad[];
  text: string;
}

/**
 * Text between two points in reading order, letter by letter (a click takes
 * the whole word). `null` when there is no text near the start point or
 * nothing is covered yet.
 */
export function selectText(layout: PageTextLayout, from: PdfPoint, to: PdfPoint): TextSelection | null {
  let s: number;
  let e: number;
  if (Math.hypot(to.x - from.x, to.y - from.y) < CLICK_DISTANCE) {
    // A click: the whole word under the pointer.
    const a = glyphAt(layout, from);
    if (a < 0) return null;
    [s, e] = snapToWords(layout, a, a);
  } else {
    // A drag: exactly the letters between the two carets.
    const a = caretAt(layout, from);
    if (a < 0) return null;
    const bRaw = caretAt(layout, to, Infinity);
    const b = bRaw < 0 ? a : bRaw;
    s = Math.min(a, b);
    e = Math.max(a, b) - 1;
    while (s <= e && layout.glyphs[s].isSpace) s++;
    while (e >= s && layout.glyphs[e].isSpace) e--;
    if (e < s) return null;
  }
  if (layout.glyphs[s]?.isSpace) return null;

  const quads: Quad[] = [];
  let text = '';
  let runItem = -1;
  let runFrom = 0;
  let runTo = 0;
  const flush = () => {
    if (runItem >= 0 && runTo > runFrom) quads.push(quadFor(frameOf(layout.items[runItem]), runFrom, runTo));
  };
  for (let i = s; i <= e; i++) {
    const g = layout.glyphs[i];
    const item = layout.items[g.item];
    if (g.item !== runItem) {
      flush();
      if (runItem >= 0) {
        const prev = layout.items[runItem];
        text += prev.hasEOL ? '\n' : (text.endsWith(' ') || item.str.startsWith(' ') ? '' : ' ');
      }
      runItem = g.item;
      runFrom = g.from;
    }
    runTo = g.to;
    text += item.str.slice(g.char, g.char + 1);
  }
  flush();
  // Line breaks between items on different lines come from hasEOL; collapse doubles.
  text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').trim();
  return quads.length ? { quads, text } : null;
}

/** Bounding box of a set of quads. */
export function quadsBounds(quads: readonly Quad[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const q of quads) for (const p of q) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * The line drawn for underline / strikethrough across a quad: a point pair at
 * `t` of the way from the bottom edge to the top edge, and the quad height.
 */
export function markupLine(q: Quad, kind: 'underline' | 'strikeout'): { from: PdfPoint; to: PdfPoint; thickness: number } {
  const t = kind === 'underline' ? 0.14 : 0.48;
  const lerp = (p: PdfPoint, r: PdfPoint): PdfPoint => ({ x: p.x + (r.x - p.x) * t, y: p.y + (r.y - p.y) * t });
  const height = Math.hypot(q[3].x - q[0].x, q[3].y - q[0].y);
  return { from: lerp(q[0], q[3]), to: lerp(q[1], q[2]), thickness: Math.max(0.6, height * 0.07) };
}

/**
 * One path for a whole text markup (screen, thumbnails and export share it):
 * highlight → the quads filled together (no double-dark overlaps);
 * underline / strikethrough → one line per quad.
 */
export function markupShape(
  markup: 'highlight' | 'underline' | 'strikeout',
  quads: readonly (readonly PdfPoint[])[],
): { shape: InkShape; width: number } {
  const commands: PathCommand[] = [];
  const valid = quads.filter((q): q is Quad => q.length === 4);
  if (markup === 'highlight') {
    for (const q of valid) {
      commands.push({ op: 'M', x: q[0].x, y: q[0].y }, { op: 'L', x: q[1].x, y: q[1].y }, { op: 'L', x: q[2].x, y: q[2].y }, { op: 'L', x: q[3].x, y: q[3].y }, { op: 'Z' });
    }
    return { shape: { mode: 'fill', commands }, width: 0 };
  }
  let width = 0;
  for (const q of valid) {
    const line = markupLine(q, markup);
    width = Math.max(width, line.thickness);
    commands.push({ op: 'M', x: line.from.x, y: line.from.y }, { op: 'L', x: line.to.x, y: line.to.y });
  }
  return { shape: { mode: 'stroke', commands }, width: width || 1 };
}
