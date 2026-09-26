import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { NOTE_TEMPLATES } from '../noteTemplates';
import { generateNewDocument } from '../newDocumentGenerator';
import { buildPdfFromPlan, planInsertBlank } from '../pagePlan';

describe('note templates', () => {
  it.each(NOTE_TEMPLATES.map((t) => t.id))('%s draws on portrait and landscape pages', async (template) => {
    for (const [w, h] of [[595, 842], [842, 595]]) {
      const bytes = await generateNewDocument({ widthPt: w, heightPt: h, pageCount: 2, background: { type: 'template', template, spacingMm: 8, color: '#999999' } });
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount()).toBe(2);
      expect(doc.getPage(0).node.Contents()).toBeDefined();
    }
  });

  it('can be inserted as a note page', async () => {
    const src = await PDFDocument.create();
    src.addPage([595, 842]);
    const bytes = await buildPdfFromPlan(await src.save(), planInsertBlank(1, 0, { background: { type: 'template', template: 'cornell', spacingMm: 8, color: '#999999' } }));
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
  });
});
