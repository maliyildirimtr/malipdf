import { describe, it, expect, beforeEach, vi } from 'vitest';
import { insertPdfPrintout } from '../printoutCommands';
import { useDocumentStore } from '../../store/documentStore';
import { useAnnotationStore } from '../../store/annotationStore';
import { useHistoryStore } from '../../store/historyStore';
import { useAssetStore } from '../../store/assetStore';
import { PDFDocument } from 'pdf-lib';
import type { DocumentState, Annotation } from '../../types/annotations';

vi.mock('../../pdf/printoutGenerator', () => {
  return {
    generatePrintoutPages: vi.fn().mockImplementation(async ({ sourcePdfBytes }) => {
      // Create fake prepared pages for the test
      const doc = await PDFDocument.load(sourcePdfBytes);
      const pages = [];
      for (let i = 0; i < doc.getPageCount(); i++) {
        pages.push({
          sourcePageIndex: i,
          widthPdfPoints: 100,
          heightPdfPoints: 100,
          rasterWidth: 200,
          rasterHeight: 200,
          asset: {
            id: `fake-asset-${i}`,
            mimeType: 'image/png',
            width: 200,
            height: 200,
            data: new Uint8Array([1, 2, 3]),
          }
        });
      }
      return pages;
    }),
    PRINT_OUT_TARGET_DPI: 144,
    PRINT_OUT_MAX_PIXEL_AREA: 16000000,
    PRINT_OUT_RENDER_CONCURRENCY: 2,
  };
});

async function createEmptyPdf(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    doc.addPage([100, 100]);
  }
  return await doc.save();
}

describe('printoutCommands', () => {
  beforeEach(() => {
    useDocumentStore.setState({ documents: new Map(), tabOrder: [], activeDocId: null });
    useAnnotationStore.setState({ docAnnotations: new Map() });
    useHistoryStore.setState({ histories: new Map() });
    useAssetStore.getState().clearAll();
    vi.clearAllMocks();
  });

  it('inserts pdf printout and updates store and history', async () => {
    const docId = 'test-doc';
    const sourceData = await createEmptyPdf(2);
    const printoutData = await createEmptyPdf(3);

    const docState: DocumentState = {
      id: docId,
      instanceId: 1,
      title: 'test.pdf',
      filePath: null,
      currentStateId: '1',
      savedStateId: '1',
      saveStatus: 'idle',
      lastSaveError: null,
      sourceData,
      sourceRevision: 1,
      activePageIndex: 0,
      pageCount: 2,
      zoom: 1,
      zoomMode: 'fitWidth',
      scrollTop: 0,
      scrollLeft: 0,
      pageRotations: { 0: 0, 1: 0 },
    };

    useDocumentStore.setState({
      documents: new Map([[docId, docState]]),
      activeDocId: docId,
    });

    useAnnotationStore.getState().initDocument(docId);
    useHistoryStore.getState().initDocument(docId);

    const annotation = {
      id: 'ann-1',
      pageIndex: 1,
      type: 'freeform',
      bounds: { x: 0, y: 0, width: 10, height: 10 },
      geometry: { type: 'freeform', lines: [] },
      style: { strokeColor: '#000', strokeWidth: 1 },
      createdAt: 0,
      updatedAt: 0,
    } as unknown as Annotation;
    useAnnotationStore.getState().addAnnotation(docId, annotation);

    const success = await insertPdfPrintout(docId, printoutData);
    expect(success).toBe(true);

    const updatedDoc = useDocumentStore.getState().documents.get(docId)!;
    expect(updatedDoc.pageCount).toBe(5); // 2 + 3
    expect(updatedDoc.sourceRevision).toBe(2);

    const updatedAnnotations = useAnnotationStore.getState().getPageAnnotations(docId, 4);
    expect(updatedAnnotations.length).toBe(1);
    expect(updatedAnnotations[0].id).toBe('ann-1');
    expect(updatedAnnotations[0].pageIndex).toBe(4); // 1 + 3

    // Check history
    expect(useHistoryStore.getState().canUndo(docId)).toBe(true);
    const historyAction = useHistoryStore.getState().histories.get(docId)!.undoStack[0];
    expect(historyAction.type).toBe('MUTATE_DOCUMENT_BYTES');
    expect(historyAction.afterPageCount).toBe(5);
    
    // Check assets registered
    const assets = useAssetStore.getState().getAssetsForDocument({ docId, instanceId: 1 });
    expect(assets?.size).toBe(3);
  });
});
