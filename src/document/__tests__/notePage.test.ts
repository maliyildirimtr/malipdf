import { describe, expect, it } from 'vitest';
import { PDFDocument, degrees } from 'pdf-lib';
import { buildPdfFromPlan, planInsertBlank, A4_PORTRAIT_PT } from '../pagePlan';
import { makePageBackground } from '../newDocumentGenerator';

async function twoPageDoc() {
  const doc = await PDFDocument.create();
  doc.addPage([842, 474]);
  doc.addPage([595, 842]).setRotation(degrees(90));
  return doc.save();
}

describe('note pages', () => {
  it('inserts a lined page the size of the slide it follows', async () => {
    const bytes = await buildPdfFromPlan(await twoPageDoc(), planInsertBlank(2, 0, { background: makePageBackground('lined', 8) }));
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(3);
    const page = doc.getPage(1);
    expect(page.getSize()).toEqual({ width: 842, height: 474 });
    expect(page.node.Contents()).toBeDefined();
  });

  it('turns a rotated page into an upright page of the shown size', async () => {
    const bytes = await buildPdfFromPlan(await twoPageDoc(), planInsertBlank(2, 1, { background: makePageBackground('grid', 5) }));
    const page = (await PDFDocument.load(bytes)).getPage(2);
    expect(page.getRotation().angle).toBe(0);
    expect(page.getSize()).toEqual({ width: 842, height: 595 });
  });

  it('can insert an A4 portrait page', async () => {
    const bytes = await buildPdfFromPlan(await twoPageDoc(), planInsertBlank(2, 0, { background: makePageBackground('dotted', 5), size: 'a4' }));
    const page = (await PDFDocument.load(bytes)).getPage(1);
    expect(page.getWidth()).toBeCloseTo(A4_PORTRAIT_PT.width);
    expect(page.getHeight()).toBeCloseTo(A4_PORTRAIT_PT.height);
  });

  it('keeps a plain blank page exactly like before', async () => {
    const plan = planInsertBlank(2, 1);
    expect(plan[2]).toEqual({ kind: 'blank', likePage: 1 });
    const page = (await PDFDocument.load(await buildPdfFromPlan(await twoPageDoc(), plan))).getPage(2);
    expect(page.getRotation().angle).toBe(90);
  });
});
