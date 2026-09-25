import { describe, it, expect, beforeEach, vi } from 'vitest';
import { insertPdfPrintout } from '../../commands/printoutCommands';
import { executeUndo, executeRedo } from '../../commands/historyCommands';
import { useDocumentStore } from '../../store/documentStore';
import { useAnnotationStore } from '../../store/annotationStore';
import { useHistoryStore } from '../../store/historyStore';
import { useAssetStore } from '../../store/assetStore';
import { PDFDocument } from 'pdf-lib';
import { type Annotation, type ImageAnnotation } from '../../types/annotations';
import type { DocumentState } from '../../types/annotations';

vi.mock('../../pdf/printoutGenerator', () => {
  return {
    generatePrintoutPages: vi.fn().mockImplementation(async ({ sourcePdfBytes }) => {
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

describe('printout transaction safety', () => {
  beforeEach(() => {
    useDocumentStore.setState({ documents: new Map(), tabOrder: [], activeDocId: null });
    useAnnotationStore.setState({ docAnnotations: new Map() });
    useHistoryStore.setState({ histories: new Map() });
    useAssetStore.getState().clearAll();
    vi.clearAllMocks();
  });

  it('supports undo and redo of imported pages with monotonic sourceRevision', async () => {
    const docId = 'test-doc';
    const sourceData = await createEmptyPdf(1);
    const printoutData = await createEmptyPdf(2);

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
      sourceRevision: 1, // Start at 1
      activePageIndex: 0,
      pageCount: 1,
      zoom: 1,
      zoomMode: 'fitWidth',
      scrollTop: 0,
      scrollLeft: 0,
      pageRotations: { 0: 0 },
    };

    useDocumentStore.setState({
      documents: new Map([[docId, docState]]),
      activeDocId: docId,
    });
    useAnnotationStore.getState().initDocument(docId);
    useHistoryStore.getState().initDocument(docId);

    // IMPORT
    const success = await insertPdfPrintout(docId, printoutData);
    expect(success).toBe(true);

    const afterImportDoc = useDocumentStore.getState().documents.get(docId)!;
    expect(afterImportDoc.pageCount).toBe(3);
    expect(afterImportDoc.sourceRevision).toBe(2); // +1 on import

    const assetsAfterImport = useAssetStore.getState().getAssetsForDocument({ docId, instanceId: 1 });
    expect(assetsAfterImport?.size).toBe(2);

    const importedAnnotations = useAnnotationStore.getState().getPageAnnotations(docId, 1);
    expect(importedAnnotations.length).toBe(1);
    expect(importedAnnotations[0].type).toBe('image');
    expect((importedAnnotations[0] as ImageAnnotation).assetId).toBe('fake-asset-0');

    // UNDO
    executeUndo(docId);
    const afterUndoDoc = useDocumentStore.getState().documents.get(docId)!;
    
    // sourceRevision must NOT decrement, it increments on ANY bytes change
    expect(afterUndoDoc.sourceRevision).toBe(3); 
    expect(afterUndoDoc.pageCount).toBe(1);
    
    const undoneAnnotations = useAnnotationStore.getState().getPageAnnotations(docId, 1);
    expect(undoneAnnotations.length).toBe(0);

    // Assets must REMAIN in the store for session lifetime so redo works immediately
    const assetsAfterUndo = useAssetStore.getState().getAssetsForDocument({ docId, instanceId: 1 });
    expect(assetsAfterUndo?.size).toBe(2);

    // REDO
    executeRedo(docId);
    const afterRedoDoc = useDocumentStore.getState().documents.get(docId)!;
    
    // sourceRevision increments again
    expect(afterRedoDoc.sourceRevision).toBe(4); 
    expect(afterRedoDoc.pageCount).toBe(3);

    const redoneAnnotations = useAnnotationStore.getState().getPageAnnotations(docId, 1);
    expect(redoneAnnotations.length).toBe(1);
    expect((redoneAnnotations[0] as ImageAnnotation).assetId).toBe('fake-asset-0');
  });
});
