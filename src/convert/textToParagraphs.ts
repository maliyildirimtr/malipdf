/**
 * Turns positioned PDF text (pdf.js text runs, or OCR lines) into Word
 * paragraphs: runs on one baseline become a line, lines that follow each
 * other closely with the same size and left edge become one paragraph.
 *
 * Coordinates are PDF points with the origin at the bottom left (y up).
 */
import type { DocxAlign, DocxParagraph, DocxRun } from './docx';

export interface PositionedRun {
  text: string;
  /** Baseline start. */
  x: number;
  y: number;
  width: number;
  size: number;
  bold?: boolean;
  italic?: boolean;
  font?: string;
}

export interface TextLineGroup {
  runs: PositionedRun[];
  x: number;
  y: number;
  right: number;
  size: number;
}

export interface PageGeometry {
  /** Left and right text margins of the Word page, in points. */
  marginLeft: number;
  marginRight: number;
  marginTop: number;
  pageWidth: number;
  pageHeight: number;
}

/** Symbol-font bullets come through as private-use characters; show them as "•". */
const PRIVATE_USE_BULLET = /^[\uE000-\uF8FF]$/;
/** A list marker at the start of a line: •, –, 1., 2), a) … */
const LIST_MARKER = /^\s*([•●▪■◦○‣∙·\-–—*]|\d{1,3}[.)]|[a-zA-Z][.)])(\s|$)/;

/** Join runs that share a baseline and follow each other into lines (stream order is kept). */
export function groupLines(runs: readonly PositionedRun[]): TextLineGroup[] {
  const lines: TextLineGroup[] = [];
  let current: TextLineGroup | null = null;
  for (const raw of runs) {
    if (!raw.text || !(raw.size > 0)) continue;
    const run = PRIVATE_USE_BULLET.test(raw.text.trim()) ? { ...raw, text: '•', font: undefined } : raw;
    if (current) {
      const sameBaseline = Math.abs(run.y - current.y) < Math.max(current.size, run.size) * 0.35;
      const gap = run.x - current.right;
      if (sameBaseline && gap > -current.size * 0.5 && gap < current.size * 3) {
        current.runs.push(run);
        current.right = Math.max(current.right, run.x + run.width);
        current.size = Math.max(current.size, run.size);
        continue;
      }
      lines.push(current);
    }
    current = { runs: [run], x: run.x, y: run.y, right: run.x + run.width, size: run.size };
  }
  if (current) lines.push(current);
  return lines.filter((line) => line.runs.some((r) => r.text.trim() !== ''));
}

function sameStyle(a: DocxRun, b: PositionedRun, size: number): boolean {
  return !!a.bold === !!b.bold && !!a.italic === !!b.italic && a.font === b.font && a.size === size;
}

const roundSize = (size: number) => Math.max(1, Math.round(size * 2) / 2);

/** A line's runs as Word runs, with spaces where the PDF left gaps. */
function lineRuns(line: TextLineGroup): DocxRun[] {
  const out: DocxRun[] = [];
  let end = -Infinity;
  for (const run of line.runs) {
    const size = roundSize(run.size);
    let text = run.text;
    const last = out[out.length - 1];
    const needsSpace = last && run.x - end > run.size * 0.2 && !/\s$/.test(last.text) && !/^\s/.test(text);
    if (needsSpace) text = ` ${text}`;
    if (last && sameStyle(last, run, size)) last.text += text;
    else out.push({ text, bold: run.bold || undefined, italic: run.italic || undefined, font: run.font, size });
    end = Math.max(end, run.x + run.width);
  }
  return out;
}

export function lineText(line: TextLineGroup): string {
  return lineRuns(line).map((r) => r.text).join('');
}

/** Append `next` runs to a paragraph, joining words split by a hyphen at the line end. */
function appendLine(runs: DocxRun[], next: DocxRun[]): void {
  const last = runs[runs.length - 1];
  const first = next[0];
  if (last && first) {
    const hyphenated = /[A-Za-zÇĞİÖŞÜçğıöşü]-$/.test(last.text) && /^[a-zçğıöşü]/.test(first.text);
    if (hyphenated) last.text = last.text.slice(0, -1);
    else if (!/\s$/.test(last.text) && !/^\s/.test(first.text)) last.text += ' ';
  }
  for (const run of next) {
    const tail = runs[runs.length - 1];
    if (tail && tail.bold === run.bold && tail.italic === run.italic && tail.font === run.font && tail.size === run.size) tail.text += run.text;
    else runs.push({ ...run });
  }
}

/** Typical gap between baselines of one paragraph's lines. */
const LINE_GAP_MAX = 1.75;

export function linesToParagraphs(lines: readonly TextLineGroup[], page: PageGeometry): DocxParagraph[] {
  const textLeft = page.marginLeft;
  const textRight = page.pageWidth - page.marginRight;
  const textWidth = Math.max(1, textRight - textLeft);
  const pageCenter = (textLeft + textRight) / 2;

  interface Para { lines: TextLineGroup[] }
  const paras: Para[] = [];
  for (const line of lines) {
    const para = paras[paras.length - 1];
    const prev = para?.lines[para.lines.length - 1];
    if (para && prev) {
      const drop = prev.y - line.y;
      const similarSize = Math.abs(line.size - prev.size) <= Math.max(prev.size, line.size) * 0.15;
      // Lines after the first share a left edge; the first may be indented.
      const alignedLeft = para.lines.length > 1
        ? Math.abs(line.x - para.lines[1].x) < prev.size
        : line.x <= prev.x + prev.size * 0.5 && line.x >= prev.x - prev.size * 4;
      // A line that stops well short of the others ends its paragraph.
      const widest = Math.max(line.right, ...para.lines.map((l) => l.right));
      const prevEndedEarly = prev.right < Math.max(widest, textRight - textWidth * 0.1) - prev.size * 4;
      const startsList = LIST_MARKER.test(lineText(line));
      const centered = Math.abs((prev.x + prev.right) / 2 - pageCenter) < textWidth * 0.03 && Math.abs((line.x + line.right) / 2 - pageCenter) < textWidth * 0.03;
      if (!startsList && drop > 0 && drop < prev.size * LINE_GAP_MAX && similarSize && ((alignedLeft && !prevEndedEarly) || centered)) {
        para.lines.push(line);
        continue;
      }
    }
    paras.push({ lines: [line] });
  }

  const out: DocxParagraph[] = [];
  let previousBottom: number | null = null;
  let previousSize = 0;
  for (const para of paras) {
    const first = para.lines[0];
    const last = para.lines[para.lines.length - 1];
    const runs: DocxRun[] = [];
    for (const line of para.lines) appendLine(runs, lineRuns(line));

    // Alignment.
    let align: DocxAlign = 'left';
    const centers = para.lines.map((l) => (l.x + l.right) / 2);
    const allCentered = centers.every((c) => Math.abs(c - pageCenter) < textWidth * 0.03);
    const narrow = para.lines.every((l) => l.right - l.x < textWidth * 0.9);
    if (allCentered && narrow && first.x > textLeft + first.size) align = 'center';
    else if (para.lines.every((l) => l.right > textRight - first.size * 0.5) && first.x > pageCenter) align = 'right';
    else if (para.lines.length > 2 && para.lines.slice(0, -1).every((l) => Math.abs(l.right - textRight) < first.size * 1.5)) align = 'both';

    // Indents (not for centred text).
    const body = para.lines.length > 1 ? Math.min(...para.lines.slice(1).map((l) => l.x)) : first.x;
    const indent = align === 'center' || align === 'right' ? 0 : Math.max(0, Math.min(textWidth * 0.6, body - textLeft));
    const firstLine = align === 'center' || align === 'right' ? 0 : Math.max(-indent, Math.min(textWidth * 0.5, first.x - body));

    // Space above: the PDF gap beyond normal line spacing.
    const top = first.y + first.size;
    let spaceBefore: number;
    if (previousBottom === null) spaceBefore = Math.max(0, Math.min(400, page.pageHeight - page.marginTop - top));
    else spaceBefore = Math.max(0, Math.min(72, (previousBottom - first.y) - Math.max(first.size, previousSize) * 1.25));

    out.push({
      kind: 'paragraph',
      runs,
      align: align === 'left' ? undefined : align,
      spaceBefore: spaceBefore >= 1 ? Math.round(spaceBefore) : undefined,
      indent: indent >= 2 ? Math.round(indent) : undefined,
      firstLine: Math.abs(firstLine) >= 2 ? Math.round(firstLine) : undefined,
    });
    previousBottom = last.y;
    previousSize = last.size;
  }
  return out;
}

