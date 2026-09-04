import { describe, it, expect, beforeEach } from 'vitest';
import { useHistoryStore } from '../historyStore';
import { useDocumentStore } from '../documentStore';
import { useAnnotationStore } from '../annotationStore';
import type { DocumentState, StrokeAnnotation, HistoryAction } from '../../types/annotations';
import { nanoid } from '../../utils/nanoid';

describe('HistoryStore & Dirty State semantics', () => {
  beforeEach(() => {
    useHistoryStore.setState({ histories: new Map() });
    useDocumentStore.setState({ documents: new Map(), activeDocId: null, tabOrder: [] });
    useAnnotationStore.setState({ docAnnotations: new Map() });
  });

  it('maintains state IDs during push, undo, redo, and correctly identifies clean/dirty states', () => {
    const docId = 'doc-1';
    
    const initialStateId = nanoid();
    
    // 1. DISKTEN AÇILAN PDF: filePath != null, currentStateId = X, savedStateId = X, dirty = false
    const doc: DocumentState = {
      id: docId,
      instanceId: 1,
      title: 'test.pdf',
      filePath: '/test.pdf',
      currentStateId: initialStateId,
      savedStateId: initialStateId, // Explicit requirement
      saveStatus: 'idle',
      lastSaveError: null,
      sourceData: new Uint8Array(0),
      activePageIndex: 0,
      pageCount: 1,
      zoom: 1,
      zoomMode: 'fitWidth',
      scrollTop: 0,
      scrollLeft: 0,
      pageRotations: {},
    };
    
    useDocumentStore.getState().openDocument(doc);
    useAnnotationStore.getState().initDocument(docId);
    
    // Verify initial clean state
    const currentDoc = () => useDocumentStore.getState().documents.get(docId)!;
    expect(currentDoc().currentStateId).toBe(currentDoc().savedStateId); // Clean
    
    // 2. Perform action A -> B
    const stroke: StrokeAnnotation = {
      id: 'a1',
      pageIndex: 0,
      type: 'stroke',
      points: [],
      width: 2,
      smooth: true,
      pressure: false,
      color: '#000',
      opacity: 1,
      locked: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    
    useAnnotationStore.getState().addAnnotation(docId, stroke);
    
    const actionB: Omit<HistoryAction, 'beforeStateId' | 'afterStateId'> = {
      type: 'ADD_ANNOTATION',
      docId,
      pageIndex: 0,
      annotationId: 'a1',
      before: null,
      after: stroke,
    };
    
    useHistoryStore.getState().push(actionB);
    const stateIdAfterB = currentDoc().currentStateId;
    
    // Now doc is dirty
    expect(currentDoc().currentStateId).toBe(stateIdAfterB);
    expect(currentDoc().currentStateId).not.toBe(currentDoc().savedStateId); // Dirty
    
    // 3. Save(B)
    useDocumentStore.getState().updateDocument(docId, {
      savedStateId: currentDoc().currentStateId
    });
    
    // Now doc is clean again
    expect(currentDoc().savedStateId).toBe(stateIdAfterB);
    expect(currentDoc().currentStateId).toBe(currentDoc().savedStateId); // Clean
    
    // 4. Perform action B -> C
    const stroke2 = { ...stroke, id: 'a2' };
    useAnnotationStore.getState().addAnnotation(docId, stroke2);
    
    const actionC: Omit<HistoryAction, 'beforeStateId' | 'afterStateId'> = {
      type: 'ADD_ANNOTATION',
      docId,
      pageIndex: 0,
      annotationId: 'a2',
      before: null,
      after: stroke2,
    };
    
    useHistoryStore.getState().push(actionC);
    const stateIdAfterC = currentDoc().currentStateId;
    
    // Now doc is dirty again
    expect(currentDoc().currentStateId).toBe(stateIdAfterC);
    expect(currentDoc().currentStateId).not.toBe(currentDoc().savedStateId); // Dirty
    
    // 5. Undo(C) -> Revert to B
    useHistoryStore.getState().undo(docId);
    
    // Should be clean again because we reverted to the saved state (stateIdAfterB)
    expect(currentDoc().currentStateId).toBe(stateIdAfterB);
    expect(currentDoc().currentStateId).toBe(currentDoc().savedStateId); // CLEAN! A -> B -> Save(B) -> C -> Undo(B) => Clean
    
    // 6. Undo(B) -> Revert to A
    useHistoryStore.getState().undo(docId);

    // Should be dirty again because we moved AWAY from the saved state (B) back to A
    expect(currentDoc().currentStateId).toBe(initialStateId);
    expect(currentDoc().currentStateId).not.toBe(currentDoc().savedStateId); // DIRTY

    // 7. Redo(B) -> Go to B
    useHistoryStore.getState().redo(docId);
    
    // Should be clean again because we moved forward to the saved state (B)
    expect(currentDoc().currentStateId).toBe(stateIdAfterB);
    expect(currentDoc().currentStateId).toBe(currentDoc().savedStateId); // CLEAN

    // 8. Redo(C) -> Go to C
    useHistoryStore.getState().redo(docId);
    
    // Should be dirty again because we moved away from the saved state
    expect(currentDoc().currentStateId).toBe(stateIdAfterC);
    expect(currentDoc().currentStateId).not.toBe(currentDoc().savedStateId); // DIRTY
  });
});
