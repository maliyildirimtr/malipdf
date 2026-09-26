/**
 * Edit PDF Text: find the line of PDF text under a click. pdf.js returns text
 * in runs (often one per font change); runs on the same baseline that follow
 * each other closely are joined into one line.
 */
import type { PdfPoint } from '../types/annotations';

export interface TextRun {
  str: string;
  /** pdf.js text matrix [a, b, c, d, e, f] (PDF space). */
  transform: number[];
  width: number;
  fontName?: string;
}

export interface TextLine {
  text: string;
  /** Baseline start (PDF space). */
  origin: PdfPoint;
  /** Baseline direction in radians (0 = left to right). */
  angle: number;
  width: number;
  fontSize: number;
  ascent: number;
  descent: number;
  /** Font of the first run (pdf.js loaded font name). */
  fontName?: string;
}

function frame(run: TextRun) {
  const [a, b, c, d, e, f] = run.transform;
  const len = Math.hypot(a, b) || 1;
  return { x: e, y: f, dx: a / len, dy: b / len, size: Math.hypot(c, d) || len };
}

/** Local (along the baseline, above the baseline) coordinates of `p`. */
function local(fr: ReturnType<typeof frame>, p: PdfPoint) {
  const vx = p.x - fr.x;
  const vy = p.y - fr.y;
  return { along: vx * fr.dx + vy * fr.dy, up: -vx * fr.dy + vy * fr.dx };
}

/** Join runs into lines (same direction and baseline, small gaps). */
export function buildLines(runs: readonly TextRun[]): TextLine[] {
  const lines: TextLine[] = [];
  let current: (TextLine & { fr: ReturnType<typeof frame> }) | null = null;
  for (const run of runs) {
    if (!run.str || !(run.width > 0)) continue;
    const fr = frame(run);
    if (current) {
      const p = local(current.fr, { x: fr.x, y: fr.y });
      const sameDir = Math.abs(fr.dx - current.fr.dx) < 0.01 && Math.abs(fr.dy - current.fr.dy) < 0.01;
      const gap = p.along - current.width;
      if (sameDir && Math.abs(p.up) < current.fontSize * 0.25 && gap > -current.fontSize * 0.5 && gap < current.fontSize * 1.2) {
        const spaced = gap > current.fontSize * 0.2 && !current.text.endsWith(' ') && !run.str.startsWith(' ');
        current.text += (spaced ? ' ' : '') + run.str;
        current.width = p.along + run.width;
        current.fontSize = Math.max(current.fontSize, fr.size);
        current.ascent = current.fontSize * 0.92;
        current.descent = current.fontSize * 0.24;
        continue;
      }
      lines.push(stripFrame(current));
    }
    current = {
      text: run.str, origin: { x: fr.x, y: fr.y }, angle: Math.atan2(fr.dy, fr.dx),
      width: run.width, fontSize: fr.size, ascent: fr.size * 0.92, descent: fr.size * 0.24,
      fontName: run.fontName, fr,
    };
  }
  if (current) lines.push(stripFrame(current));
  return lines.filter((l) => l.text.trim() !== '');
}

function stripFrame(line: TextLine & { fr: unknown }): TextLine {
  const { fr: _fr, ...rest } = line;
  void _fr;
  return rest;
}

/** The line whose box contains `p` (with a little slack), nearest first. */
export function lineAt(lines: readonly TextLine[], p: PdfPoint, slack = 2): TextLine | null {
  let best: TextLine | null = null;
  let bestDistance = Infinity;
  for (const line of lines) {
    const dx = Math.cos(line.angle);
    const dy = Math.sin(line.angle);
    const vx = p.x - line.origin.x;
    const vy = p.y - line.origin.y;
    const along = vx * dx + vy * dy;
    const up = -vx * dy + vy * dx;
    if (along < -slack || along > line.width + slack || up < -line.descent - slack || up > line.ascent + slack) continue;
    const distance = Math.abs(up - (line.ascent - line.descent) / 2);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = line;
    }
  }
  return best;
}

/** Guess bold / italic / family from a PDF font name such as "ABCDEF+Arial-BoldItalicMT". */
export function fontStyleFromName(name: string | undefined, fallbackFamily = 'sans-serif') {
  const n = (name ?? '').replace(/^[A-Z]{6}\+/, '');
  const lower = n.toLowerCase();
  const bold = /bold|black|heavy|semibold|demi/.test(lower);
  const italic = /italic|oblique/.test(lower);
  const family = /mono|courier|consol|menlo/.test(lower) ? 'mono'
    : /times|serif|roman|georgia|garamond|cambria|minion|book/.test(lower) && !/sans/.test(lower) ? 'serif'
      : fallbackFamily === 'serif' ? 'serif' : fallbackFamily === 'monospace' ? 'mono' : 'sans';
  return { bold, italic, family: family as 'sans' | 'serif' | 'mono' };
}
