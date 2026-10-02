/**
 * Removes PDF text under edited lines ("Edit PDF Text").
 *
 * An edit used to only cover the old line with a box, so the old words stayed
 * in the page: search, copy and screen readers still found them. On save and
 * export, the text-showing operators (Tj, TJ, ', ") whose start lies inside an
 * edited line's area are now cut out of the page content.
 *
 * The page gets NEW content streams; the original stream objects are left
 * untouched, so MaliPDF's editable data can still restore the original page
 * (and the edit stays undoable after reopening). Text inside Form XObjects is
 * not changed (the cover box still hides it).
 */
import { PDFArray, PDFName, PDFRawStream, PDFRef, PDFStream, decodePDFRawStream, type PDFContext, type PDFPage } from 'pdf-lib';
import type { PdfPoint } from '../types/annotations';

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** a × b (PDF row-vector convention: point · a · b). */
function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}

function apply(m: Matrix, x: number, y: number): PdfPoint {
  return { x: x * m[0] + y * m[2] + m[4], y: x * m[1] + y * m[3] + m[5] };
}

// ─── Tokenizer ───────────────────────────────────────────────────────────────

interface Token { kind: 'number' | 'operand' | 'operator'; start: number; end: number; value?: number; text?: string }

const WHITESPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIMITERS = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

function isRegular(byte: number): boolean {
  return !WHITESPACE.has(byte) && !DELIMITERS.has(byte);
}

/** Content stream tokens with byte offsets. Arrays and dicts are single operand tokens. */
export function tokenize(bytes: Uint8Array): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = bytes.length;
  const skipString = (from: number): number => {
    let depth = 0;
    let j = from;
    while (j < n) {
      const c = bytes[j];
      if (c === 0x5c) { j += 2; continue; } // backslash escape
      if (c === 0x28) depth++;
      else if (c === 0x29) { depth--; if (depth === 0) return j + 1; }
      j++;
    }
    return n;
  };
  const skipValue = (from: number): number => {
    const c = bytes[from];
    if (c === 0x28) return skipString(from);
    if (c === 0x3c && bytes[from + 1] === 0x3c) { // << dict >>
      let j = from + 2;
      while (j < n && !(bytes[j] === 0x3e && bytes[j + 1] === 0x3e)) j = WHITESPACE.has(bytes[j]) ? j + 1 : skipValue(j);
      return Math.min(n, j + 2);
    }
    if (c === 0x3c) { let j = from + 1; while (j < n && bytes[j] !== 0x3e) j++; return Math.min(n, j + 1); }
    if (c === 0x5b) { // [ array ]
      let j = from + 1;
      while (j < n && bytes[j] !== 0x5d) j = WHITESPACE.has(bytes[j]) ? j + 1 : skipValue(j);
      return Math.min(n, j + 1);
    }
    if (c === 0x2f) { let j = from + 1; while (j < n && isRegular(bytes[j])) j++; return j; }
    if (c === 0x25) { let j = from; while (j < n && bytes[j] !== 0x0a && bytes[j] !== 0x0d) j++; return j; }
    let j = from;
    while (j < n && isRegular(bytes[j])) j++;
    return Math.max(j, from + 1);
  };

  while (i < n) {
    const c = bytes[i];
    if (WHITESPACE.has(c)) { i++; continue; }
    if (c === 0x25) { while (i < n && bytes[i] !== 0x0a && bytes[i] !== 0x0d) i++; continue; }
    const start = i;
    const end = skipValue(i);
    const word = String.fromCharCode(...bytes.subarray(start, Math.min(end, start + 16)));
    if (c === 0x28 || c === 0x3c || c === 0x5b || c === 0x2f) {
      tokens.push({ kind: 'operand', start, end });
    } else if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) {
      tokens.push({ kind: 'number', start, end, value: Number(word) });
    } else {
      tokens.push({ kind: 'operator', start, end, text: word });
      if (word === 'BI') {
        // Inline image: skip binary data up to "EI" on its own.
        let j = end;
        while (j < n && !(bytes[j] === 0x49 && bytes[j + 1] === 0x44 && WHITESPACE.has(bytes[j + 2] ?? 0x20))) j++;
        j += 3;
        while (j < n && !(WHITESPACE.has(bytes[j - 1]) && bytes[j] === 0x45 && bytes[j + 1] === 0x49 && (j + 2 >= n || WHITESPACE.has(bytes[j + 2])))) j++;
        tokens.push({ kind: 'operator', start: end, end: Math.min(n, j + 2), text: 'EI' });
        i = Math.min(n, j + 2);
        continue;
      }
    }
    i = end;
  }
  return tokens;
}

// ─── Finding text inside the edited areas ────────────────────────────────────

function insideQuad(p: PdfPoint, quad: readonly PdfPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = quad.length - 1; i < quad.length; j = i++) {
    const a = quad[i];
    const b = quad[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

interface GraphicsState { ctm: Matrix }

/**
 * Byte ranges of text operators (with their operands) whose text starts inside
 * one of `areas`. State carries over between the streams of one page.
 */
export function findTextToRemove(streams: readonly Uint8Array[], areas: readonly (readonly PdfPoint[])[]): Array<Array<[number, number]>> {
  const stack: GraphicsState[] = [];
  let gs: GraphicsState = { ctm: IDENTITY };
  let tm: Matrix = IDENTITY;
  let tlm: Matrix = IDENTITY;
  let leading = 0;
  let rise = 0;
  let fontSize = 0;
  // After a show operator the pen moved by an unknown amount (no font
  // metrics here); the next show on the same line follows the previous one.
  let positionKnown = true;
  let lastRemoved = false;

  return streams.map((bytes) => {
    const cuts: Array<[number, number]> = [];
    const tokens = tokenize(bytes);
    let operands: Token[] = [];
    const nums = () => operands.map((t) => t.value ?? 0);
    for (const token of tokens) {
      if (token.kind !== 'operator') { operands.push(token); continue; }
      const op = token.text ?? '';
      const args = nums();
      switch (op) {
        case 'q': stack.push({ ctm: gs.ctm }); break;
        case 'Q': gs = stack.pop() ?? { ctm: IDENTITY }; break;
        case 'cm': if (args.length === 6) gs = { ctm: multiply(args as Matrix, gs.ctm) }; break;
        case 'BT': tm = IDENTITY; tlm = IDENTITY; positionKnown = true; lastRemoved = false; break;
        case 'Tf': if (args.length >= 1) fontSize = args[args.length - 1]; break;
        case 'TL': if (args.length) leading = args[0]; break;
        case 'Ts': if (args.length) rise = args[0]; break;
        case 'Td': case 'TD':
          if (args.length === 2) {
            if (op === 'TD') leading = -args[1];
            tlm = multiply([1, 0, 0, 1, args[0], args[1]], tlm); tm = tlm; positionKnown = true;
          }
          break;
        case 'Tm': if (args.length === 6) { tlm = args as Matrix; tm = tlm; positionKnown = true; } break;
        case 'T*': tlm = multiply([1, 0, 0, 1, 0, -leading], tlm); tm = tlm; positionKnown = true; break;
        case "'": case '"': case 'Tj': case 'TJ': {
          if (op === "'" || op === '"') { tlm = multiply([1, 0, 0, 1, 0, -leading], tlm); tm = tlm; positionKnown = true; }
          const m = multiply(tm, gs.ctm);
          // A point a little above the baseline start, in page space.
          const size = Math.abs(fontSize) * Math.hypot(m[2], m[3]) || 1;
          const base = apply(m, 0, rise);
          const up = { x: -m[1], y: m[0] };
          const len = Math.hypot(up.x, up.y) || 1;
          const probe = { x: base.x + (up.x / len) * size * 0.3, y: base.y + (up.y / len) * size * 0.3 };
          const remove = positionKnown ? areas.some((quad) => insideQuad(probe, quad)) : lastRemoved;
          if (remove) cuts.push([operands[0]?.start ?? token.start, token.end]);
          lastRemoved = remove;
          positionKnown = false;
          break;
        }
        default: break;
      }
      operands = [];
    }
    return cuts;
  });
}

function cut(bytes: Uint8Array, ranges: readonly [number, number][]): Uint8Array {
  if (ranges.length === 0) return bytes;
  const parts: Uint8Array[] = [];
  let at = 0;
  for (const [start, end] of [...ranges].sort((a, b) => a[0] - b[0])) {
    if (start < at) continue;
    parts.push(bytes.subarray(at, start), new Uint8Array([0x20]));
    at = end;
  }
  parts.push(bytes.subarray(at));
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

function streamBytes(context: PDFContext, ref: PDFRef): Uint8Array | null {
  const stream = context.lookup(ref);
  try {
    if (stream instanceof PDFRawStream) return decodePDFRawStream(stream).decode();
    if (stream instanceof PDFStream) return stream.getContents();
  } catch {
    return null; // a filter pdf-lib cannot decode: leave the page as it is
  }
  return null;
}

/**
 * Cut the text inside `areas` out of the page's own content. Returns the
 * number of text operators removed and the original streams that were replaced.
 */
export function removeTextInAreas(context: PDFContext, page: PDFPage, areas: readonly (readonly PdfPoint[])[]): { removed: number; replaced: PDFRef[] } {
  const none = { removed: 0, replaced: [] as PDFRef[] };
  if (areas.length === 0) return none;
  const contents = page.node.get(PDFName.of('Contents'));
  const refs: PDFRef[] = contents instanceof PDFRef
    ? (context.lookup(contents) instanceof PDFArray ? (context.lookup(contents) as PDFArray).asArray() as PDFRef[] : [contents])
    : contents instanceof PDFArray ? contents.asArray().filter((r): r is PDFRef => r instanceof PDFRef) : [];
  if (refs.length === 0) return none;
  const decoded = refs.map((ref) => streamBytes(context, ref));
  if (decoded.some((d) => d === null)) return none;
  const cuts = findTextToRemove(decoded as Uint8Array[], areas);
  const removed = cuts.reduce((sum, c) => sum + c.length, 0);
  if (removed === 0) return none;
  const next = refs.map((ref, index) => (cuts[index].length
    ? context.register(context.flateStream(cut(decoded[index]!, cuts[index])))
    : ref));
  page.node.set(PDFName.of('Contents'), next.length === 1 ? next[0] : context.obj(next));
  return { removed, replaced: refs.filter((_, index) => cuts[index].length > 0) };
}

