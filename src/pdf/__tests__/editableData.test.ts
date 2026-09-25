import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PDFArray, PDFDict, PDFDocument, PDFName, StandardFonts, rgb, decodePDFRawStream, PDFRawStream } from 'pdf-lib';
import { exportAnnotatedPdf } from '../annotationExporter';
import { collectGarbage, extractEditableData, hasEditableMarker } from '../editableData';
import type { Annotation } from '../../types/annotations';
import type { ImageAsset } from '../../store/assetStore';

const fontkitName = '@pdf-lib/fontkit';
const fontkit = await import(/* @vite-ignore */ fontkitName).then((m) => m.default, () => null);
const fonts = fontkit
  ? { fontkit, load: async () => new Uint8Array(readFileSync(resolve(__dirname, '../../assets/fonts/LiberationSans-Regular.ttf'))) }
  : undefined;

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
const asset: ImageAsset = { id: 'img1', mimeType: 'image/png', width: 1, height: 1, data: PNG };

const base = { opacity: 1, locked: false, createdAt: 0, updatedAt: 0 };
const annotations = (): Annotation[] => [
  { ...base, id: 's1', type: 'shape', shapeKind: 'rectangle', pageIndex: 0, startPoint: { x: 10, y: 10 }, endPoint: { x: 60, y: 60 }, strokeWidth: 2, fillColor: 'transparent', color: '#ff0000' } as Annotation,
  { ...base, id: 'i1', type: 'image', pageIndex: 1, assetId: 'img1', x: 20, y: 20, width: 40, height: 40, color: '#000000' } as unknown as Annotation,
  { ...base, id: 'h1', type: 'shape', shapeKind: 'line', pageIndex: 1, startPoint: { x: 0, y: 0 }, endPoint: { x: 5, y: 5 }, strokeWidth: 1, fillColor: 'transparent', color: '#000000', hidden: true } as Annotation,
  ...(fonts ? [{
    ...base, id: 't1', type: 'text', pageIndex: 0, color: '#000000', bounds: { x: 20, y: 100, width: 200, height: 30 },
    content: 'Iğdır şoför', fontSize: 12, fontFamily: 'Arial', bold: false, italic: false, underline: false, align: 'left', backgroundColor: 'transparent',
  } as Annotation] : []),
];

async function sourcePdf(inheritResources = false) {
  const doc = await PDFDocument.create();
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const first = doc.addPage([300, 300]);
  first.drawText('Original page one', { x: 20, y: 250, size: 12, font: helvetica, color: rgb(0, 0, 0) });
  doc.addPage([300, 300]); // empty page, no content stream
  if (inheritResources) {
    const res = first.node.get(PDFName.of('Resources'))!;
    doc.catalog.Pages().set(PDFName.of('Resources'), res);
    first.node.delete(PDFName.of('Resources'));
  }
  return doc.save();
}

const byPage = (list: Annotation[]) => {
  const map = new Map<number, Annotation[]>();
  for (const a of list) map.set(a.pageIndex, [...(map.get(a.pageIndex) ?? []), a]);
  return map;
};

async function save(bytes: Uint8Array, list = annotations()) {
  return (await exportAnnotatedPdf(bytes, byPage(list), { assets: new Map([[asset.id, asset]]), fonts, editable: true })).data;
}

async function pageSummary(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray().map((r) => doc.context.lookup(r)) : contents ? [contents] : [];
    const text = streams.map((s) => new TextDecoder().decode(s instanceof PDFRawStream ? decodePDFRawStream(s).decode() : new Uint8Array())).join('|');
    const res = doc.context.lookupMaybe(page.node.getInheritableAttribute(PDFName.of('Resources')), PDFDict);
    const font = res ? doc.context.lookupMaybe(res.get(PDFName.of('Font')), PDFDict) : undefined;
    return { text, fonts: font?.keys().map((k) => k.asString()).sort() ?? [], annots: page.node.get(PDFName.of('Annots')) !== undefined };
  });
}

describe('editable save', () => {
  it.each([false, true])('round-trips annotations and restores the original pages (inherited resources: %s)', async (inherit) => {
    const original = await sourcePdf(inherit);
    const saved = await save(original);
    expect(hasEditableMarker(saved)).toBe(true);

    const result = await extractEditableData(saved);
    expect(result.kind).toBe('restored');
    if (result.kind !== 'restored') return;
    expect(result.annotations.map((a) => a.id).sort()).toEqual(annotations().map((a) => a.id).sort());
    expect(result.annotations.find((a) => a.id === 'h1')?.hidden).toBe(true);
    expect(result.assets).toEqual([{ ...asset }]);
    expect(await pageSummary(result.bytes)).toEqual(await pageSummary(original));
    expect(hasEditableMarker(result.bytes)).toBe(false);
  });

  it('does not grow when saved and reopened again and again', async () => {
    let bytes = await sourcePdf();
    const sizes: number[] = [];
    for (let round = 0; round < 3; round++) {
      const saved = await save(bytes);
      const result = await extractEditableData(saved);
      if (result.kind !== 'restored') throw new Error('not restored');
      bytes = result.bytes;
      sizes.push(saved.length);
    }
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThan(64);
  });

  it('ignores the data when another app changed a page', async () => {
    const saved = await save(await sourcePdf());
    const other = await PDFDocument.load(saved);
    other.getPage(0).drawRectangle({ x: 1, y: 1, width: 5, height: 5 });
    const edited = await other.save({ useObjectStreams: false });
    expect((await extractEditableData(edited)).kind).toBe('changedElsewhere');

    const removed = await PDFDocument.load(saved);
    removed.removePage(1);
    expect((await extractEditableData(await removed.save({ useObjectStreams: false }))).kind).toBe('changedElsewhere');
  });

  it('keeps working after another app rewrote the file without changing pages', async () => {
    const saved = await save(await sourcePdf());
    const rewritten = await (await PDFDocument.load(saved)).save({ useObjectStreams: false });
    expect((await extractEditableData(rewritten)).kind).toBe('restored');
  });

  it('leaves normal PDFs and Export output alone', async () => {
    const original = await sourcePdf();
    expect(await extractEditableData(original)).toEqual({ kind: 'none' });
    const exported = (await exportAnnotatedPdf(original, byPage(annotations()), { assets: new Map([[asset.id, asset]]), fonts })).data;
    expect(await extractEditableData(exported)).toEqual({ kind: 'none' });
  });

  it('writes no MaliPDF data when there are no annotations', async () => {
    const saved = (await exportAnnotatedPdf(await sourcePdf(), new Map(), { editable: true })).data;
    expect(hasEditableMarker(saved)).toBe(false);
  });

  it('garbage collection keeps everything reachable', async () => {
    const doc = await PDFDocument.load(await sourcePdf());
    doc.context.register(doc.context.obj({ Orphan: 1 }));
    expect(collectGarbage(doc.context)).toBe(1);
    expect(await pageSummary(await doc.save())).toEqual(await pageSummary(await sourcePdf()));
  });
});
