import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFDict, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import type { Annotation, TextMarkupAnnotation } from '../../types/annotations';
import { exportAnnotatedPdf } from '../annotationExporter';
import { getAnnotationBounds } from '../annotationGeometry';
import { hitTestAnnotation } from '../annotationHitTest';
import { translateAnnotation } from '../annotationTransform';

const quad = [{ x: 100, y: 98 }, { x: 150, y: 98 }, { x: 150, y: 110 }, { x: 100, y: 110 }];

function markup(kind: TextMarkupAnnotation['markup']): TextMarkupAnnotation {
  return {
    id: `m-${kind}`, pageIndex: 0, type: 'markup', markup: kind, quads: [quad], text: 'hello',
    color: '#ffeb3b', opacity: 0.45, locked: false, createdAt: 1, updatedAt: 1,
  };
}

async function pageContent(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const contents = doc.getPage(0).node.Contents();
  const streams = contents instanceof PDFRawStream ? [contents]
    : contents ? (contents as unknown as { asArray(): unknown[] }).asArray().map((ref) => doc.context.lookup(ref as never)) : [];
  return streams.map((s) => new TextDecoder().decode(decodePDFRawStream(s as PDFRawStream).decode())).join('\n');
}

describe('text markup annotations', () => {
  it('exports a multiplied highlight fill and an underline stroke', async () => {
    const source = await PDFDocument.create();
    source.addPage([300, 300]);
    const bytes = await source.save();
    const map = new Map<number, readonly Annotation[]>([[0, [markup('highlight'), markup('underline')]]]);
    const result = await exportAnnotatedPdf(bytes, map);
    const content = await pageContent(result.data);
    expect(content).toMatch(/100 98 m\s+150 98 l\s+150 110 l\s+100 110 l\s+h\s+f/);
    expect(content).toMatch(/150 99.68 l\s+S/);
    const doc = await PDFDocument.load(result.data);
    const resources = doc.getPage(0).node.Resources()!;
    const ext = resources.lookup(PDFName.of('ExtGState'), PDFDict);
    const blends = ext.values().map((ref) => (doc.context.lookup(ref) as PDFDict).get(PDFName.of('BM'))?.toString());
    expect(blends).toContain('/Multiply');
  });

  it('is hit, bounded and not moved', () => {
    const m = markup('strikeout');
    expect(hitTestAnnotation({ x: 120, y: 104 }, m, 0)).toBe(true);
    expect(hitTestAnnotation({ x: 120, y: 130 }, m, 2)).toBe(false);
    expect(getAnnotationBounds(m)).toEqual({ x: 100, y: 98, width: 50, height: 12 });
    expect(translateAnnotation(m, 10, 10)).toBe(m);
  });
});
