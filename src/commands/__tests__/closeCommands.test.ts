import { describe, expect, it, vi, beforeEach } from 'vitest';
import { closeDocumentById, closeAllDocuments } from '../documentCommands';
import { useDocumentStore } from '../../store/documentStore';
import { useAnnotationStore } from '../../store/annotationStore';
import { documentSessionStore } from '../../store/documentSessionStore';
import * as saveCommands from '../saveCommands';

// Mock everything needed for IPC
const askCloseConfirmMock = vi.fn();
const askCloseAllConfirmMock = vi.fn();

// The mocked window.electronAPI
vi.stubGlobal('window', {
  electronAPI: {
    askCloseConfirm: askCloseConfirmMock,
    askCloseAllConfirm: askCloseAllConfirmMock,
  },
});

// Mock documentManager
vi.mock('../../pdf/documentManager', () => ({
  closeDocument: vi.fn(),
}));

// Mock saveCommands to track write behaviors without actual files
vi.mock('../saveCommands', () => ({
  saveDocument: vi.fn(),
}));

describe('Document Close UX Commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDocumentStore.setState({ documents: new Map(), tabOrder: [], activeDocId: null });
    useAnnotationStore.setState({ docAnnotations: new Map() });
    documentSessionStore.setState({ sessions: new Map() });
  });

  function setupDocument(docId: string, title: string, isDirty: boolean, hasFilePath: boolean) {
    const currentStateId = 'state-b';
    const savedStateId = isDirty ? 'state-a' : 'state-b';

    useDocumentStore.getState().documents.set(docId, {
      id: docId,
      instanceId: `inst-${docId}`,
      title,
      filePath: hasFilePath ? `/path/to/${title}` : null,
      sourceData: new Uint8Array(),
      pageCount: 1,
      savedStateId,
      currentStateId,
      saveStatus: 'idle',
      lastSaveError: null,
    } as any);

    useDocumentStore.getState().tabOrder.push(docId);
    
    // Setup dummy session
    documentSessionStore.getState().sessions.set(`inst-${docId}`, {} as any);
  }

  describe('Single Document Close (Tab X / Cmd+W / File->Close)', () => {
    it('closes clean document immediately without dialog', async () => {
      setupDocument('doc-clean', 'Clean.pdf', false, true);

      const result = await closeDocumentById('doc-clean');
      
      expect(result).toBe(true);
      expect(askCloseConfirmMock).not.toHaveBeenCalled();
      expect(useDocumentStore.getState().documents.has('doc-clean')).toBe(false);
    });

    it('stays open if user Cancels dirty existing document', async () => {
      setupDocument('doc-dirty', 'Dirty.pdf', true, true);
      askCloseConfirmMock.mockResolvedValueOnce('cancel');

      const result = await closeDocumentById('doc-dirty');
      
      expect(result).toBe(false);
      expect(askCloseConfirmMock).toHaveBeenCalledWith('Dirty.pdf');
      expect(saveCommands.saveDocument).not.toHaveBeenCalled();
      expect(useDocumentStore.getState().documents.has('doc-dirty')).toBe(true);
      expect(documentSessionStore.getState().sessions.size).toBe(1); // session intact
    });

    it('closes after successful Save on dirty existing document', async () => {
      setupDocument('doc-dirty', 'Dirty.pdf', true, true);
      askCloseConfirmMock.mockResolvedValueOnce('save');
      vi.mocked(saveCommands.saveDocument).mockResolvedValueOnce(true);

      const result = await closeDocumentById('doc-dirty');
      
      expect(result).toBe(true);
      expect(askCloseConfirmMock).toHaveBeenCalledWith('Dirty.pdf');
      expect(saveCommands.saveDocument).toHaveBeenCalledWith('doc-dirty');
      expect(useDocumentStore.getState().documents.has('doc-dirty')).toBe(false);
    });

    it('stays open if Save fails on dirty existing document', async () => {
      setupDocument('doc-dirty', 'Dirty.pdf', true, true);
      askCloseConfirmMock.mockResolvedValueOnce('save');
      vi.mocked(saveCommands.saveDocument).mockResolvedValueOnce(false); // e.g. permission error

      const result = await closeDocumentById('doc-dirty');
      
      expect(result).toBe(false);
      expect(saveCommands.saveDocument).toHaveBeenCalledWith('doc-dirty');
      expect(useDocumentStore.getState().documents.has('doc-dirty')).toBe(true);
      expect(documentSessionStore.getState().sessions.size).toBe(1);
    });

    it('closes without saving if user selects Don\'t Save (discard)', async () => {
      setupDocument('doc-dirty', 'Dirty.pdf', true, true);
      askCloseConfirmMock.mockResolvedValueOnce('discard');

      const result = await closeDocumentById('doc-dirty');
      
      expect(result).toBe(true);
      expect(askCloseConfirmMock).toHaveBeenCalledWith('Dirty.pdf');
      expect(saveCommands.saveDocument).not.toHaveBeenCalled(); // zero write calls
      expect(useDocumentStore.getState().documents.has('doc-dirty')).toBe(false);
    });

    it('handles generated/untitled document Save -> Save As -> Success -> Close', async () => {
      setupDocument('doc-untitled', 'Untitled.pdf', true, false);
      askCloseConfirmMock.mockResolvedValueOnce('save');
      vi.mocked(saveCommands.saveDocument).mockResolvedValueOnce(true); // Mock simulated Save As success

      const result = await closeDocumentById('doc-untitled');
      
      expect(result).toBe(true);
      expect(saveCommands.saveDocument).toHaveBeenCalledWith('doc-untitled');
      expect(useDocumentStore.getState().documents.has('doc-untitled')).toBe(false);
    });

    it('handles generated/untitled document Save -> Save As Cancel -> Stay Open', async () => {
      setupDocument('doc-untitled', 'Untitled.pdf', true, false);
      askCloseConfirmMock.mockResolvedValueOnce('save');
      vi.mocked(saveCommands.saveDocument).mockResolvedValueOnce(false); // Mock simulated Save As cancellation

      const result = await closeDocumentById('doc-untitled');
      
      expect(result).toBe(false);
      expect(saveCommands.saveDocument).toHaveBeenCalledWith('doc-untitled');
      expect(useDocumentStore.getState().documents.has('doc-untitled')).toBe(true); // Stays open
    });
  });

  describe('Close All Documents (Cmd+Q / Close Window)', () => {
    it('uses single document dialog if only one document is dirty', async () => {
      setupDocument('doc-1', 'Clean1.pdf', false, true);
      setupDocument('doc-2', 'Dirty.pdf', true, true); // only this is dirty
      setupDocument('doc-3', 'Clean2.pdf', false, true);

      askCloseConfirmMock.mockResolvedValueOnce('discard');

      const result = await closeAllDocuments();

      expect(result).toBe(3); // 3 docs closed
      expect(askCloseConfirmMock).toHaveBeenCalledWith('Dirty.pdf');
      expect(askCloseAllConfirmMock).not.toHaveBeenCalled();
      expect(saveCommands.saveDocument).not.toHaveBeenCalled(); // Don't save
      
      expect(useDocumentStore.getState().documents.size).toBe(0);
    });

    it('aborts close all if the single dirty document cancels', async () => {
      setupDocument('doc-1', 'Clean1.pdf', false, true);
      setupDocument('doc-2', 'Dirty.pdf', true, true);
      setupDocument('doc-3', 'Clean2.pdf', false, true);

      askCloseConfirmMock.mockResolvedValueOnce('cancel');

      const result = await closeAllDocuments();

      expect(result).toBe(0); 
      // Ensure EVERYTHING is still open
      expect(useDocumentStore.getState().documents.size).toBe(3);
    });

    it('uses multiple document dialog if multiple are dirty', async () => {
      setupDocument('doc-1', 'Dirty1.pdf', true, true);
      setupDocument('doc-2', 'Dirty2.pdf', true, true);

      askCloseAllConfirmMock.mockResolvedValueOnce('discard');

      const result = await closeAllDocuments();

      expect(result).toBe(2);
      expect(askCloseAllConfirmMock).toHaveBeenCalledWith(['Dirty1.pdf', 'Dirty2.pdf']);
      expect(askCloseConfirmMock).not.toHaveBeenCalled();
      expect(useDocumentStore.getState().documents.size).toBe(0);
    });
  });
});
