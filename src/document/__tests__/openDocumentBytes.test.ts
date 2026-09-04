import { describe, expect, it, vi, beforeEach } from 'vitest';
import { openDocumentBytes } from '../openDocumentBytes';
import { useDocumentStore } from '../../store/documentStore';
import { useAnnotationStore } from '../../store/annotationStore';
import { useHistoryStore } from '../../store/historyStore';
import { documentSessionStore } from '../../store/documentSessionStore';
import * as documentManager from '../../pdf/documentManager';

// Mock nanoid to have predictable docIds and stateIds
vi.mock('../../utils/nanoid', () => ({
  nanoid: vi.fn()
    .mockReturnValueOnce('mock-doc-id-1')
    .mockReturnValueOnce('mock-state-id-1')
    .mockReturnValueOnce('mock-doc-id-2')
    .mockReturnValueOnce('mock-state-id-2'),
}));

vi.mock('../../pdf/documentManager', () => ({
  openDocument: vi.fn().mockResolvedValue({
    identity: { docId: 'mock-doc-id-1', instanceId: 1 },
    pageCount: 3,
  }),
}));

describe('openDocumentBytes', () => {
  beforeEach(() => {
    useDocumentStore.setState({ documents: new Map(), tabOrder: [], activeDocId: null });
    documentSessionStore.setState({ sessions: new Map() });
    vi.clearAllMocks();
  });

  it('opens a document with a filepath cleanly', async () => {
    vi.mocked(documentManager.openDocument).mockResolvedValueOnce({
      identity: { docId: 'mock-doc-id-1', instanceId: 1 },
      pageCount: 3,
    });

    const data = new ArrayBuffer(10);
    const docId = await openDocumentBytes('TestDoc.pdf', '/path/to/TestDoc.pdf', data);
    
    expect(docId).toBe('mock-doc-id-1');
    const docStore = useDocumentStore.getState();
    const doc = docStore.documents.get(docId)!;
    
    expect(doc).toBeDefined();
    expect(doc.filePath).toBe('/path/to/TestDoc.pdf');
    expect(doc.savedStateId).toBe('mock-state-id-1');
    expect(doc.currentStateId).toBe('mock-state-id-1');
    expect(doc.pageCount).toBe(3);
    
    // Clean (not dirty)
    expect(doc.currentStateId === doc.savedStateId).toBe(true);
  });

  it('opens a document without a filepath as dirty', async () => {
    vi.mocked(documentManager.openDocument).mockResolvedValueOnce({
      identity: { docId: 'mock-doc-id-2', instanceId: 2 },
      pageCount: 1,
    });

    const data = new ArrayBuffer(10);
    const docId = await openDocumentBytes('Untitled.pdf', null, data);
    
    expect(docId).toBe('mock-doc-id-2');
    const docStore = useDocumentStore.getState();
    const doc = docStore.documents.get(docId)!;
    
    expect(doc).toBeDefined();
    expect(doc.filePath).toBeNull();
    expect(doc.savedStateId).toBeNull();
    expect(doc.currentStateId).toBe('mock-state-id-2');
    
    // Dirty
    expect(doc.currentStateId !== doc.savedStateId).toBe(true);
  });
});
