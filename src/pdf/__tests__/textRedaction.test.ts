import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDocument, PDFName, PDFRawStream, PDFRef, StandardFonts, decodePDFRawStream } from 'pdf-lib';
import { findTextToRemove, tokenize, removeTextInAreas } from '../textRedaction';
import { applyTextEdits } from '../textSearch';
import { coverQuad } from '../textEdit';
import { exportAnnotatedPdf } from '../annotationExporter';
import { extractEditableData } from '../editableData';
import type { Annotation } from '../../types/annotations';

const enc = (s: string) => new TextEncoder().encode(s);
const hex = (s: string) => [...s].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('').toUpperCase();

async function twoLinePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Eski satir', { x: 50, y: 300, size: 14, font });
  page.drawText('Kalan satir', { x: 50, y: 250, size: 14, font });
  return doc.save();
}

function pageContent(doc: PDFDocument): string {
  const contents = doc.getPage(0).node.get(PDFName.of('Contents'));
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  return refs.map((ref) => {
    const stream = doc.context.lookup(ref as PDFRef);
    return stream instanceof PDFRawStream ? new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode()) : '';
  }).join('\n');
}

const area = (x: number, y: number, w: number, size: number) => coverQuad({ origin: { x, y }, angle: 0, ascent: size * 0.9, descent: size * 0.25 }, w);

describe('text redaction', () => {
  it('tokenizes strings, arrays and inline images', () => {
    const tokens = tokenize(enc('BT /F1 12 Tf (a\\)b(c)) Tj [(x) -20 (y)] TJ ET BI /W 1 /H 1 ID \x00\xff EI Q'));
    expect(tokens.filter((t) => t.kind === 'operator').map((t) => t.text)).toEqual(['BT', 'Tf', 'Tj', 'TJ', 'ET', 'BI', 'EI', 'Q']);
  });

  it('finds text shown inside an area, following Td, Tm and cm', () => {
    const content = enc('q 1 0 0 1 10 0 cm BT /F1 12 Tf 40 300 Td (Old) Tj ( more) Tj 0 -50 Td (Keep) Tj ET Q BT 1 0 0 1 50 100 Tm (Other) Tj ET');
    const [cuts] = findTextToRemove([content], [area(50, 300, 100, 12)]);
    const removed = cuts.map(([a, b]) => new TextDecoder().decode(content.subarray(a, b)));
    expect(removed).toEqual(['(Old) Tj', '( more) Tj']);
  });

  it('removes the old line from a page and keeps the rest', async () => {
    const doc = await PDFDocument.load(await twoLinePdf());
    expect(pageContent(doc)).toContain(hex('Eski satir'));
    const result = removeTextInAreas(doc.context, doc.getPage(0), [area(50, 300, 80, 14)]);
    expect(result.removed).toBe(1);
    const text = pageContent(doc);
    expect(text).not.toContain(hex('Eski satir'));
    expect(text).toContain(hex('Kalan satir'));
  });

  it('export drops the old words from the saved PDF', async () => {
    const edit: Annotation = {
      id: 'e1', type: 'textEdit', pageIndex: 0, color: '#000000', opacity: 1, locked: false, createdAt: 0, updatedAt: 0,
      origin: { x: 50, y: 300 }, angle: 0, originalWidth: 70, ascent: 13, descent: 3.5, original: 'Eski satir',
      text: 'Yeni', textWidth: 30, fontSize: 14, fontFamily: 'Arial', bold: false, italic: false, background: '#ffffff',
    } as Annotation;
    const result = await exportAnnotatedPdf(await twoLinePdf(), new Map([[0, [edit]]]));
    const reloaded = await PDFDocument.load(result.data);
    // Not in any stream of the file (the replaced original stream is gone too).
    const everything = reloaded.context.enumerateIndirectObjects()
      .map(([, object]) => (object instanceof PDFRawStream ? new TextDecoder('latin1').decode(decodePDFRawStream(object).decode()) : ''))
      .join('\n');
    expect(everything).not.toContain(hex('Eski satir'));
    expect(everything).toContain(hex('Yeni'));
    expect(pageContent(reloaded)).toContain(hex('Kalan satir'));
  });

  it('an editable save can still be undone after reopening', async () => {
    const edit = {
      id: 'e2', type: 'textEdit', pageIndex: 0, color: '#000000', opacity: 1, locked: false, createdAt: 0, updatedAt: 0,
      origin: { x: 50, y: 300 }, angle: 0, originalWidth: 70, ascent: 13, descent: 3.5, original: 'Eski satir',
      text: 'Yeni', textWidth: 30, fontSize: 14, fontFamily: 'Arial', bold: false, italic: false, background: '#ffffff',
    } as Annotation;
    const saved = await exportAnnotatedPdf(await twoLinePdf(), new Map([[0, [edit]]]), { editable: true });
    // The page itself no longer shows the old words…
    expect(pageContent(await PDFDocument.load(saved.data))).not.toContain(hex('Eski satir'));
    // …but reopening in MaliPDF restores the original page and the edit.
    const restored = await extractEditableData(saved.data);
    expect(restored.kind).toBe('restored');
    if (restored.kind !== 'restored') return;
    expect(pageContent(await PDFDocument.load(restored.bytes))).toContain(hex('Eski satir'));
    expect(restored.annotations.map((a) => a.type)).toEqual(['textEdit']);
  });

  it('search sees the edited text instead of the old one', () => {
    const items = [
      { str: 'Eski satır', transform: [14, 0, 0, 14, 50, 300], width: 70, height: 14 },
      { str: 'Kalan', transform: [14, 0, 0, 14, 50, 250], width: 40, height: 14 },
    ];
    const out = applyTextEdits(items, [{ origin: { x: 50, y: 300 }, angle: 0, originalWidth: 70, ascent: 13, descent: 3.5, text: 'Yeni metin', textWidth: 60, fontSize: 14 }]);
    expect(out.map((i) => i.str)).toEqual(['Kalan', 'Yeni metin']);
  });
});
