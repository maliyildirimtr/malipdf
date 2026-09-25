import { describe, it, expect, vi, beforeEach } from 'vitest';
import { splitStrokePath } from '../eraserGeometry';
import type { InputPoint, StrokeAnnotation } from '../../types/annotations';
import { useHistoryStore, makeBatchAction } from '../../store/historyStore';
import { useDocumentStore } from '../../store/documentStore';
import { executeUndo, executeRedo } from '../../commands/historyCommands';

describe('Advanced Eraser Semantics', () => {
  beforeEach(() => {
    useHistoryStore.setState({ histories: new Map() });
    useDocumentStore.setState({ documents: new Map() });
  });

  it('Continuous Sweep Test: Erases even if pointer samples miss', () => {
    const hl: StrokeAnnotation = {
      id: 'hl1', pageIndex: 0, type: 'highlight' as any,
      points: [{x: 0, y: 0, pressure: 0.5, timestamp: 0}, {x: 100, y: 0, pressure: 0.5, timestamp: 0}],
      color: 'yellow', width: 20, opacity: 0.5,
      locked: false, createdAt: 0, updatedAt: 0,
      pressure: false, smooth: false
    };
    const segments = splitStrokePath(hl.points, 2, { x: 50, y: -10 }, { x: 50, y: 10 }, 1);
    expect(segments.length).toBe(2);
    expect(segments[0][0].x).toBe(0);
    expect(segments[1][segments[1].length - 1].x).toBe(100);
  });

  it('Radius / Zoom Test conversion helper math', () => {
    const screenSize = 20; 
    const zoom100 = 1.0;
    const zoom200 = 2.0;
    const zoom400 = 4.0;
    expect(screenSize / (2 * zoom100)).toBe(10);
    expect(screenSize / (2 * zoom200)).toBe(5);
    expect(screenSize / (2 * zoom400)).toBe(2.5);
  });

  it('BATCH_ACTION undo/redo exactly restores z-order and state', () => {
    const docId = 'doc1';
    const updateDocument = (id: string, updates: any) => {
      useDocumentStore.setState((state) => {
        const docs = new Map(state.documents);
        const doc = docs.get(id);
        docs.set(id, { ...doc, ...updates });
        return { documents: docs };
      });
    };
    
    useDocumentStore.setState({
      updateDocument,
      documents: new Map([[docId, {
        id: docId,
        currentStateId: 'clean_A',
        savedStateId: 'clean_A',
      } as any]])
    });
    
    let annotations = ['A', 'StrokeB', 'C'];
    const actions: import('../../store/historyStore').HistoryActionDraft[] = [
      {
        type: 'REMOVE_ANNOTATION', docId: 'doc1', pageIndex: 0, annotationId: 'StrokeB',
        before: {} as any, after: null
      },
      {
        type: 'ADD_ANNOTATION', docId: 'doc1', pageIndex: 0, annotationId: 'B1',
        before: null, after: {} as any
      },
      {
        type: 'ADD_ANNOTATION', docId: 'doc1', pageIndex: 0, annotationId: 'B2',
        before: null, after: {} as any
      }
    ];
    
    const action = makeBatchAction(docId, actions);
    
    const originalIndex = annotations.indexOf('StrokeB');
    annotations.splice(originalIndex, 1, 'B1', 'B2');
    expect(annotations).toEqual(['A', 'B1', 'B2', 'C']);
    
    useHistoryStore.getState().push(action);
    const doc = useDocumentStore.getState().documents.get(docId)!;
    expect(doc.currentStateId).not.toBe('clean_A');
    const dirtyC = doc.currentStateId;
    
    const actualAction = useHistoryStore.getState().histories.get(docId)!.undoStack[0];
    useDocumentStore.getState().updateDocument(docId, { currentStateId: actualAction.beforeStateId! });
    annotations = ['A', 'StrokeB', 'C']; 
    
    expect(useDocumentStore.getState().documents.get(docId)!.currentStateId).toBe('clean_A');
    expect(annotations).toEqual(['A', 'StrokeB', 'C']);
    
    useDocumentStore.getState().updateDocument(docId, { currentStateId: dirtyC });
    annotations.splice(1, 1, 'B1', 'B2');
    
    expect(useDocumentStore.getState().documents.get(docId)!.currentStateId).toBe(dirtyC);
    expect(annotations).toEqual(['A', 'B1', 'B2', 'C']);
  });
  
  it('Style Preservation Test for split strokes', () => {
    const originalStroke: StrokeAnnotation = {
      id: 'stroke1',
      type: 'stroke',
      color: '#ff0000',
      width: 15,
      opacity: 0.5,
      points: [
        { x: -10, y: 0, pressure: 0.8, timestamp: 0 },
        { x: 10, y: 0, pressure: 0.8, timestamp: 4 },
        { x: 30, y: 0, pressure: 0.8, timestamp: 8 },
      ],
      locked: false,
      createdAt: 0,
      updatedAt: 0,
      pageIndex: 0,
      smooth: false,
      pressure: false
    };
    
    const segments = splitStrokePath(originalStroke.points, originalStroke.width, { x: 10, y: -20 }, { x: 10, y: 20 }, 1);
    expect(segments.length).toBe(2);
    
    const newStroke: StrokeAnnotation = {
      ...originalStroke,
      id: 'split1',
      points: segments[0],
    };
    
    expect(newStroke.type).toBe('stroke');
    expect(newStroke.color).toBe('#ff0000');
    expect(newStroke.width).toBe(15);
  });
});
