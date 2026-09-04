import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { saveDocument, saveDocumentAs, saveAllDocuments } from '../saveCommands';
import { useDocumentStore } from '../../store/documentStore';
import { useHistoryStore } from '../../store/historyStore';
import { useAnnotationStore } from '../../store/annotationStore';
import { exportAnnotatedPdf } from '../../pdf/annotationExporter';

vi.mock('../../pdf/annotationExporter', () => ({
  exportAnnotatedPdf: vi.fn(),
  buildAnnotationsMap: vi.fn().mockReturnValue(new Map()),
}));

describe('saveCommands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDocumentStore.setState({ documents: new Map(), activeDocId: null, tabOrder: [] });
    useHistoryStore.setState({ histories: new Map() });
    useAnnotationStore.setState({ docAnnotations: new Map() });
    
    // Mock window.electronAPI
    (global as any).window = {
      electronAPI: {
        writeFile: vi.fn().mockResolvedValue(true),
        saveFile: vi.fn(),
      }
    };
  });

  afterEach(() => {
    delete (global as any).window;
  });

  function setupDocument(id: string, isDirty: boolean) {
    const doc = {
      id,
      instanceId: `${id}-inst`,
      filePath: `/fake/path/${id}.pdf`,
      title: `${id}.pdf`,
      sourceData: new ArrayBuffer(10),
      totalPages: 1,
      activePageIndex: 0,
      zoom: 1,
      currentStateId: isDirty ? 'state-2' : 'state-1',
      savedStateId: 'state-1',
      saveStatus: 'idle' as const,
      lastSaveError: null,
    };
    useDocumentStore.getState().documents.set(id, doc as any);
    useAnnotationStore.getState().docAnnotations.set(id, { pages: new Map() });
    return doc;
  }

  describe('saveDocument', () => {
    it('Save Race: currentStateId updates during async save should leave doc DIRTY', async () => {
      setupDocument('doc-1', true);
      
      // Delay the file write so we can simulate an edit
      const { writeFile } = window.electronAPI as any;
      let resolveWrite: (value: boolean) => void;
      writeFile.mockImplementation(() => new Promise((resolve) => {
        resolveWrite = resolve;
      }));

      (exportAnnotatedPdf as any).mockResolvedValue({ data: new Uint8Array(20) });

      const savePromise = saveDocument('doc-1');
      
      // While it's yielding in writeFile, simulate an edit
      useDocumentStore.setState((state) => {
        const d = state.documents.get('doc-1')!;
        return { documents: new Map(state.documents).set('doc-1', { ...d, currentStateId: 'state-3' }) };
      });

      // Complete the save
      await Promise.resolve();
      await Promise.resolve();
      if (resolveWrite!) resolveWrite(true);
      const success = await savePromise;
      
      expect(success).toBe(true);
      
      const finalDoc = useDocumentStore.getState().documents.get('doc-1')!;
      // It should have saved the snapshot (state-2), but current is now state-3
      expect(finalDoc.savedStateId).toBe('state-2');
      expect(finalDoc.currentStateId).toBe('state-3');
      expect(finalDoc.currentStateId).not.toBe(finalDoc.savedStateId); // DIRTY
    });

    it('Double Flatten: sourceData should not be mutated after save', async () => {
      const doc = setupDocument('doc-1', true);
      const originalSourceData = doc.sourceData;
      
      (exportAnnotatedPdf as any).mockResolvedValue({ data: new Uint8Array(20) });
      (window.electronAPI.writeFile as any).mockResolvedValue(true);

      const success = await saveDocument('doc-1');
      
      expect(success).toBe(true);
      const finalDoc = useDocumentStore.getState().documents.get('doc-1')!;
      expect(finalDoc.sourceData).toBe(originalSourceData); // strict equality
    });
  });

  describe('saveDocumentAs', () => {
    it('Cancellation does not mutate state', async () => {
      const doc = setupDocument('doc-1', true);
      
      (window.electronAPI.saveFile as any).mockResolvedValue(null); // Cancelled

      const success = await saveDocumentAs('doc-1');
      
      expect(success).toBe(false);
      const finalDoc = useDocumentStore.getState().documents.get('doc-1')!;
      expect(finalDoc.filePath).toBe(doc.filePath);
      expect(finalDoc.savedStateId).toBe(doc.savedStateId);
    });

    it('Success updates filePath, title, and savedStateId', async () => {
      setupDocument('doc-1', true);
      
      (window.electronAPI.saveFile as any).mockResolvedValue('/new/path/doc-1-new.pdf');
      (exportAnnotatedPdf as any).mockResolvedValue({ data: new Uint8Array(20) });
      (window.electronAPI.writeFile as any).mockResolvedValue(true);

      const success = await saveDocumentAs('doc-1');
      
      expect(success).toBe(true);
      const finalDoc = useDocumentStore.getState().documents.get('doc-1')!;
      expect(finalDoc.filePath).toBe('/new/path/doc-1-new.pdf');
      expect(finalDoc.title).toBe('doc-1-new.pdf');
      expect(finalDoc.savedStateId).toBe('state-2'); // CLEAN
    });
  });

  describe('saveAllDocuments', () => {
    it('Stops saving remaining documents if one fails', async () => {
      useDocumentStore.setState({ tabOrder: ['doc-1', 'doc-2', 'doc-3'] });
      setupDocument('doc-1', true); // Dirty
      setupDocument('doc-2', true); // Dirty
      setupDocument('doc-3', true); // Dirty
      
      (exportAnnotatedPdf as any).mockResolvedValue({ data: new Uint8Array(20) });
      
      const { writeFile } = window.electronAPI as any;
      // doc-1 succeeds, doc-2 fails, doc-3 should not be attempted
      writeFile.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      await saveAllDocuments();
      
      const docs = useDocumentStore.getState().documents;
      expect(docs.get('doc-1')!.savedStateId).toBe('state-2'); // Saved
      expect(docs.get('doc-2')!.savedStateId).toBe('state-1'); // Failed
      expect(docs.get('doc-3')!.savedStateId).toBe('state-1'); // Not attempted
      
      expect(writeFile).toHaveBeenCalledTimes(2);
    });
  });
});
