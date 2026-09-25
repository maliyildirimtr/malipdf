/**
 * Shared text-box layout for Text annotations: the canvas renderer, the PDF
 * exporter and auto-sizing all use this, so what you see is what is saved.
 *
 * Units are PDF points. Lines advance by LINE_HEIGHT × fontSize; the box has
 * TEXT_PADDING on every side. List items get a "• " / "1. " marker and a
 * hanging indent for wrapped continuation lines.
 */
import type { TextAnnotation, TextListStyle } from '../types/annotations';

export const TEXT_PADDING = 4;
export const LINE_HEIGHT = 1.4;
/** Auto-sized boxes never grow wider than this (then text wraps). */
export const MAX_AUTO_TEXT_WIDTH = 420;
const MIN_TEXT_WIDTH = 24;

export type MeasureText = (text: string) => number;

export interface LaidOutLine {
  text: string;
  /** Offset from the text area's left edge (hanging indent / marker). */
  indent: number;
  /** List marker drawn at the start of an item's first line. */
  marker?: string;
}

function listMarker(style: TextListStyle | undefined, ordinal: number): string | undefined {
  if (style === 'bullet') return '•';
  if (style === 'number') return `${ordinal}.`;
  return undefined;
}

/** Break paragraphs into lines no wider than `maxWidth`. */
export function layoutTextLines(
  content: string,
  listStyle: TextListStyle | undefined,
  maxWidth: number,
  measure: MeasureText,
): LaidOutLine[] {
  const lines: LaidOutLine[] = [];
  let ordinal = 0;
  for (const paragraph of content.split('\n')) {
    const isItem = !!listStyle && listStyle !== 'none' && paragraph.trim().length > 0;
    const marker = isItem ? listMarker(listStyle, ++ordinal) : undefined;
    const indent = marker ? measure(`${marker} `) + measure(' ') : 0;
    const wrapped = wrapWords(paragraph, Math.max(1, maxWidth - indent), measure);
    wrapped.forEach((text, index) => {
      lines.push({ text, indent, marker: index === 0 ? marker : undefined });
    });
  }
  return lines;
}

function wrapWords(text: string, maxWidth: number, measure: MeasureText): string[] {
  if (!text) return [''];
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && measure(candidate) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
    // A single word wider than the box is broken by characters.
    while (measure(current) > maxWidth && current.length > 1) {
      let cut = current.length - 1;
      while (cut > 1 && measure(current.slice(0, cut)) > maxWidth) cut--;
      lines.push(current.slice(0, cut));
      current = current.slice(cut);
    }
  }
  lines.push(current);
  return lines;
}

/**
 * Size a text box to its content: as wide as the longest line (up to
 * `maxWidth`), as tall as its lines. Returns width/height in PDF points.
 */
export function autoSizeTextBox(
  annotation: Pick<TextAnnotation, 'content' | 'fontSize' | 'listStyle'>,
  measure: MeasureText,
  maxWidth = MAX_AUTO_TEXT_WIDTH,
): { width: number; height: number } {
  const innerMax = Math.max(MIN_TEXT_WIDTH, maxWidth) - TEXT_PADDING * 2;
  const lines = layoutTextLines(annotation.content, annotation.listStyle, innerMax, measure);
  const widest = Math.max(0, ...lines.map((line) => line.indent + measure(line.text)));
  return {
    width: Math.max(MIN_TEXT_WIDTH, Math.ceil(widest + TEXT_PADDING * 2 + 1)),
    height: Math.ceil(lines.length * annotation.fontSize * LINE_HEIGHT + TEXT_PADDING * 2),
  };
}

/** CSS font shorthand for canvas/DOM measurement. */
export function cssFont(annotation: Pick<TextAnnotation, 'fontSize' | 'fontFamily' | 'bold' | 'italic'>): string {
  return [annotation.italic ? 'italic' : '', annotation.bold ? 'bold' : '', `${annotation.fontSize}px`, annotation.fontFamily]
    .filter(Boolean)
    .join(' ');
}

let measureContext: CanvasRenderingContext2D | null | undefined;

/** Measure with a shared offscreen canvas; falls back to an estimate without a DOM (tests). */
export function canvasMeasure(annotation: Pick<TextAnnotation, 'fontSize' | 'fontFamily' | 'bold' | 'italic'>): MeasureText {
  if (measureContext === undefined) {
    measureContext = typeof document !== 'undefined'
      ? document.createElement('canvas').getContext('2d')
      : null;
  }
  const ctx = measureContext;
  if (!ctx) return (text) => text.length * annotation.fontSize * 0.55;
  const font = cssFont(annotation);
  return (text) => {
    ctx.font = font;
    return ctx.measureText(text).width;
  };
}
