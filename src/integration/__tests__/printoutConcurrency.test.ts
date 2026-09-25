import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';

const PNG = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
));

// Rasterization needs a real canvas; replace only the generator with a
// controllable stand-in so the test can act while the import is "running".
let releaseGeneration: () => void = () => {};
vi.mock('../../pdf/printoutGenerator', () => ({
  generatePrintoutPages: vi.fn(async () => {
    await new Promise<void>((resolve) => { releaseGeneration = resolve; });
    return [{
      sourcePageIndex: 0, widthPdfPoints: 100, heightPdfPoints: 100, rasterWidth: 1, rasterHeight: 1,
      asset: { id: 'printout-asset', mimeType: 'image/png', width: 1, height: 1, data: PNG },
    }];
  }),
}));

import { insertPdfPrintout } from '../../commands/printoutCommands';
import { useDocumentStore } from '../../store/documentStore';
import { useAnnotationStore } from '../../store/annotationStore';
import { useHistoryStore } from '../../store/historyStore';
import { useAssetStore } from '../../store/assetStore';
import { useImportJobStore } from '../../store/importJobStore';
import { buildAnnotationsMap, exportAnnotatedPdf } from '../../pdf/annotationExporter';

async function pdf(pages: number) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([100, 100]);
  return doc.save();
}

async function openDoc(docId: string) {
  useDocumentStore.getState().openDocument({
    id: docId, instanceId: 1, title: 'd.pdf', filePath: null, currentStateId: 's0', savedStateId: null,
    saveStatus: 'idle', lastSaveError: null, sourceData: await pdf(2), sourceRevision: 1,
    activePageIndex: 0, pageCount: 2, zoom: 1, zoomMode: 'custom', scrollTop: 0, scrollLeft: 0, pageRotations: {},
  });
  useAnnotationStore.getState().initDocument(docId);
  useHistoryStore.getState().initDocument(docId);
}

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('PDF printout commit safety', () => {
  beforeEach(() => {
    useDocumentStore.setState({ documents: new Map(), tabOrder: [], activeDocId: null });
    useAnnotationStore.setState({ docAnnotations: new Map() });
    useHistoryStore.setState({ histories: new Map() });
    useAssetStore.getState().clearAll();
    useImportJobStore.getState().clearJob();
  });

  it('keeps annotations drawn while the import was running, and the result is exportable', async () => {
    await openDoc('P');
    const running = insertPdfPrintout('P', await pdf(1));
    await tick();

    useAnnotationStore.getState().addAnnotation('P', {
      id: 'drawn-during-import', type: 'stroke', pageIndex: 1,
      points: [{ x: 1, y: 1, pressure: 0.5, timestamp: 0 }, { x: 9, y: 9, pressure: 0.5, timestamp: 0 }],
      width: 1, smooth: false, pressure: false, color: '#000000', opacity: 1, locked: false, createdAt: 0, updatedAt: 0,
    });
    releaseGeneration();
    expect(await running).toBe(true);

    const docAnnotations = useAnnotationStore.getState().docAnnotations.get('P')!;
    const all = [...docAnnotations.pages.values()].flatMap((p) => p.annotations);
    // Printout inserted after page 0, so the old page 1 is now page 2.
    expect(all.find((a) => a.id === 'drawn-during-import')?.pageIndex).toBe(2);
    expect(all.find((a) => a.type === 'image')?.pageIndex).toBe(1);

    const doc = useDocumentStore.getState().documents.get('P')!;
    const assets = useAssetStore.getState().getAssetsForDocument({ docId: 'P', instanceId: 1 });
    const exported = await exportAnnotatedPdf(doc.sourceData, buildAnnotationsMap(docAnnotations), { assets });
    expect(exported.pageCount).toBe(3);
    expect(exported.annotationCount).toBe(2);
  });

  it('refuses a second import while one is running', async () => {
    await openDoc('Q');
    const first = insertPdfPrintout('Q', await pdf(1));
    await tick();
    await expect(insertPdfPrintout('Q', await pdf(1))).resolves.toBe(false);
    releaseGeneration();
    await expect(first).resolves.toBe(true);
  });

  it('discards the result when the document was closed meanwhile', async () => {
    await openDoc('C');
    const running = insertPdfPrintout('C', await pdf(1));
    await tick();
    useDocumentStore.getState().closeDocument('C');
    releaseGeneration();
    await expect(running).resolves.toBe(false);
    expect(useImportJobStore.getState().job).toBeNull();
  });
});
