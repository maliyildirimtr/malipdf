import { useAnnotationStore } from '../store/annotationStore';
import { useHistoryStore } from '../store/historyStore';
import type { Annotation, HistoryAction } from '../types/annotations';

import { useDocumentStore } from '../store/documentStore';

type HistoryState = ReturnType<typeof useHistoryStore.getState>;
type AnnotationState = ReturnType<typeof useAnnotationStore.getState>;
type DocumentStateStore = ReturnType<typeof useDocumentStore.getState>;

export interface HistoryCommandDependencies {
  readonly history: Pick<HistoryState, 'undo' | 'redo'>;
  readonly annotations: Pick<
    AnnotationState,
    'addAnnotation' | 'removeAnnotation' | 'replaceAnnotation' | 'docAnnotations'
  >;
  readonly document: Pick<
    DocumentStateStore,
    'updateDocument'
  >;
}

/**
 * Advances the document's history and applies the inverse annotation mutation.
 * All mutations go through the existing public Zustand store actions.
 */
export function executeUndo(
  docId: string,
  dependencies: HistoryCommandDependencies = currentDependencies(),
): HistoryAction | null {
  const action = dependencies.history.undo(docId);
  if (!action) return null;

  applyUndoAction(action, dependencies);
  return action;
}

/**
 * Advances the document's history and re-applies the annotation mutation.
 * All mutations go through the existing public Zustand store actions.
 */
export function executeRedo(
  docId: string,
  dependencies: HistoryCommandDependencies = currentDependencies(),
): HistoryAction | null {
  const action = dependencies.history.redo(docId);
  if (!action) return null;

  applyRedoAction(action, dependencies);
  return action;
}

function currentDependencies(): HistoryCommandDependencies {
  return {
    history: useHistoryStore.getState(),
    annotations: useAnnotationStore.getState(),
    document: useDocumentStore.getState(),
  };
}

function applyUndoAction(
  action: Omit<HistoryAction, 'beforeStateId' | 'afterStateId'>,
  dependencies: HistoryCommandDependencies,
): void {
  const { annotations, document } = dependencies;
  switch (action.type) {
    case 'ADD_ANNOTATION':
      if (action.after && action.pageIndex !== undefined && action.annotationId !== undefined) {
        annotations.removeAnnotation(action.docId, action.pageIndex, action.annotationId);
      }
      return;
    case 'REMOVE_ANNOTATION':
      if (action.before) addAt(annotations, action.docId, action.before, action.index);
      return;
    case 'UPDATE_ANNOTATION':
    case 'MOVE_ANNOTATION':
    case 'RESIZE_ANNOTATION':
      if (action.before && action.pageIndex !== undefined) replace(annotations, action.docId, action.pageIndex, action.before);
      return;
    case 'MUTATE_DOCUMENT_BYTES':
      if (action.beforeSourceData && action.beforePageRotations && action.beforePageCount !== undefined) {
        // Restore document bytes and rotations
        const currentDoc = useDocumentStore.getState().documents.get(action.docId);
        if (currentDoc) {
          document.updateDocument(action.docId, {
            sourceData: action.beforeSourceData,
            sourceRevision: currentDoc.sourceRevision + 1,
            pageRotations: action.beforePageRotations,
            pageCount: action.beforePageCount,
            activePageIndex: Math.max(0, Math.min(currentDoc.activePageIndex, action.beforePageCount - 1)),
          });
        }
        
        // Restore annotations if provided
        if (action.beforeAnnotations) {
          useAnnotationStore.setState((state) => {
            const docs = new Map(state.docAnnotations);
            const docState = docs.get(action.docId);
            if (!docState) return state;
            
            const newDocState = { pages: new Map() };
            for (const ann of action.beforeAnnotations!) {
              if (!newDocState.pages.has(ann.pageIndex)) {
                newDocState.pages.set(ann.pageIndex, { pageIndex: ann.pageIndex, annotations: [] });
              }
              newDocState.pages.get(ann.pageIndex)!.annotations.push(ann);
            }
            docs.set(action.docId, newDocState);
            return { docAnnotations: docs };
          });
        }
      }
      return;
    case 'BATCH_ACTION':
      if (action.actions) {
        // Undo batch actions in reverse order
        for (let i = action.actions.length - 1; i >= 0; i--) {
          applyUndoAction(action.actions[i], dependencies);
        }
      }
      return;
  }
}

function applyRedoAction(
  action: Omit<HistoryAction, 'beforeStateId' | 'afterStateId'>,
  dependencies: HistoryCommandDependencies,
): void {
  const { annotations, document } = dependencies;
  switch (action.type) {
    case 'ADD_ANNOTATION':
      if (action.after) addAt(annotations, action.docId, action.after, action.index);
      return;
    case 'REMOVE_ANNOTATION':
      if (action.before && action.pageIndex !== undefined && action.annotationId !== undefined) {
        annotations.removeAnnotation(action.docId, action.pageIndex, action.annotationId);
      }
      return;
    case 'UPDATE_ANNOTATION':
    case 'MOVE_ANNOTATION':
    case 'RESIZE_ANNOTATION':
      if (action.after && action.pageIndex !== undefined) replace(annotations, action.docId, action.pageIndex, action.after);
      return;
    case 'MUTATE_DOCUMENT_BYTES':
      if (action.afterSourceData && action.afterPageRotations && action.afterPageCount !== undefined) {
        // Restore document bytes and rotations
        const currentDoc = useDocumentStore.getState().documents.get(action.docId);
        if (currentDoc) {
          document.updateDocument(action.docId, {
            sourceData: action.afterSourceData,
            sourceRevision: currentDoc.sourceRevision + 1,
            pageRotations: action.afterPageRotations,
            pageCount: action.afterPageCount,
            activePageIndex: Math.max(0, Math.min(currentDoc.activePageIndex, action.afterPageCount - 1)),
          });
        }
        
        // Restore annotations if provided
        if (action.afterAnnotations) {
          useAnnotationStore.setState((state) => {
            const docs = new Map(state.docAnnotations);
            const docState = docs.get(action.docId);
            if (!docState) return state;
            
            const newDocState = { pages: new Map() };
            for (const ann of action.afterAnnotations!) {
              if (!newDocState.pages.has(ann.pageIndex)) {
                newDocState.pages.set(ann.pageIndex, { pageIndex: ann.pageIndex, annotations: [] });
              }
              newDocState.pages.get(ann.pageIndex)!.annotations.push(ann);
            }
            docs.set(action.docId, newDocState);
            return { docAnnotations: docs };
          });
        }
      }
      return;
    case 'BATCH_ACTION':
      if (action.actions) {
        // Redo batch actions in forward order
        for (const subAction of action.actions) {
          applyRedoAction(subAction, dependencies);
        }
      }
      return;
  }
}

function addAt(
  annotations: HistoryCommandDependencies['annotations'],
  docId: string,
  annotation: Annotation,
  index: number | undefined,
): void {
  if (index === undefined) annotations.addAnnotation(docId, annotation);
  else annotations.addAnnotation(docId, annotation, index);
}

function replace(
  annotations: HistoryCommandDependencies['annotations'],
  docId: string,
  pageIndex: number,
  annotation: Annotation,
): void {
  annotations.replaceAnnotation(docId, pageIndex, annotation);
}
