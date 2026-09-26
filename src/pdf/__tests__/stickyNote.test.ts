import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFHexString } from 'pdf-lib';
import { exportAnnotatedPdf } from '../annotationExporter';
import { extractEditableData } from '../editableData';
import { getAnnotationBounds } from '../annotationGeometry';
import { translateAnnotation } from '../annotationTransform';
import { describeAnnotation } from '../../commands/annotationListCommands';
import { noteIconContent } from '../noteExport';
import { noteShade } from '../noteIcon';
import { NOTE_ICON_SIZE, type Annotation, type NoteAnnotation } from '../../types/annotations';

const note = (patch: Partial<NoteAnnotation> = {}): NoteAnnotation => ({
  id: 'n1', pageIndex: 0, type: 'note', x: 50, y: 200, content: 'Sınava kadar çalış', color: '#F5C400',
  opacity: 1, locked: false, createdAt: 0, updatedAt: Date.UTC(2026, 8, 26), ...patch,
});

async function source(withAnnot = false) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  if (withAnnot) {
    const link = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 10, 10] }));
    page.node.addAnnot(link);
  }
  return doc.save();
}

function textAnnots(doc: PDFDocument) {
  const annots = doc.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  return (annots?.asArray() ?? [])
    .map((ref) => doc.context.lookup(ref, PDFDict))
    .filter((dict) => dict.get(PDFName.of('Subtype'))?.toString() === '/Text');
}

describe('sticky notes', () => {
  it('have fixed-size bounds and move as a whole', () => {
    const n = note();
    expect(getAnnotationBounds(n)).toEqual({ x: 50, y: 200, width: NOTE_ICON_SIZE, height: NOTE_ICON_SIZE });
    const moved = translateAnnotation(n, 10, -5) as NoteAnnotation;
    expect([moved.x, moved.y]).toEqual([60, 195]);
    expect(describeAnnotation(n)).toBe('Note: Sınava kadar çalış');
    expect(describeAnnotation(note({ content: '' }))).toBe('Note');
  });

  it('are saved as real PDF comments with the text and an icon', async () => {
    const out = await exportAnnotatedPdf(await source(), new Map([[0, [note() as Annotation]]]));
    const doc = await PDFDocument.load(out.data);
    const [dict] = textAnnots(doc);
    expect(dict).toBeDefined();
    const contents = dict.get(PDFName.of('Contents'));
    expect(contents).toBeInstanceOf(PDFHexString);
    expect((contents as PDFHexString).decodeText()).toBe('Sınava kadar çalış');
    expect(dict.lookup(PDFName.of('Rect'), PDFArray).asArray().map(String)).toEqual(['50', '200', '70', '220']);
    expect(dict.lookupMaybe(PDFName.of('AP'), PDFDict)?.get(PDFName.of('N'))).toBeDefined();
  });

  it('are not duplicated when an editable save is reopened', async () => {
    const out = await exportAnnotatedPdf(await source(true), new Map([[0, [note() as Annotation]]]), { editable: true });
    const restored = await extractEditableData(out.data);
    expect(restored.kind).toBe('restored');
    if (restored.kind !== 'restored') return;
    expect(restored.annotations).toHaveLength(1);
    expect((restored.annotations[0] as NoteAnnotation).content).toBe('Sınava kadar çalış');
    const doc = await PDFDocument.load(restored.bytes);
    expect(textAnnots(doc)).toHaveLength(0);
    // The PDF's own link survives.
    expect(doc.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray)?.size()).toBe(1);
  });

  it('draws the icon in its box', () => {
    const content = noteIconContent('#F5C400', 20);
    expect(content).toMatch(/\nB\n/);
    expect(content).toContain('0.961 0.769 0 rg');
    expect(noteShade('#ffffff', 0.5)).toBe('#808080');
  });
});
