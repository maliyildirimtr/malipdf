import { useAnnotationStore } from '../store/annotationStore';
import { useHistoryStore } from '../store/historyStore';
import type { Annotation, HistoryAction } from '../types/annotations';

type HistoryState = ReturnType<typeof useHistoryStore.getState>;
type AnnotationState = ReturnType<typeof useAnnotationStore.getState>;

export interface HistoryCommandDependencies {
  readonly history: Pick<HistoryState, 'undo' | 'redo'>;
  readonly annotations: Pick<
    AnnotationState,
    'addAnnotation' | 'removeAnnotation' | 'replaceAnnotation'
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

  applyUndoAction(action, dependencies.annotations);
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

  applyRedoAction(action, dependencies.annotations);
  return action;
}

function currentDependencies(): HistoryCommandDependencies {
  return {
    history: useHistoryStore.getState(),
    annotations: useAnnotationStore.getState(),
  };
}

function applyUndoAction(
  action: HistoryAction,
  annotations: HistoryCommandDependencies['annotations'],
): void {
  switch (action.type) {
    case 'ADD_ANNOTATION':
      if (action.after) {
        annotations.removeAnnotation(action.docId, action.pageIndex, action.annotationId);
      }
      return;
    case 'REMOVE_ANNOTATION':
      if (action.before) annotations.addAnnotation(action.docId, action.before);
      return;
    case 'UPDATE_ANNOTATION':
    case 'MOVE_ANNOTATION':
    case 'RESIZE_ANNOTATION':
      if (action.before) replace(annotations, action.docId, action.pageIndex, action.before);
      return;
  }
}

function applyRedoAction(
  action: HistoryAction,
  annotations: HistoryCommandDependencies['annotations'],
): void {
  switch (action.type) {
    case 'ADD_ANNOTATION':
      if (action.after) annotations.addAnnotation(action.docId, action.after);
      return;
    case 'REMOVE_ANNOTATION':
      if (action.before) {
        annotations.removeAnnotation(action.docId, action.pageIndex, action.annotationId);
      }
      return;
    case 'UPDATE_ANNOTATION':
    case 'MOVE_ANNOTATION':
    case 'RESIZE_ANNOTATION':
      if (action.after) replace(annotations, action.docId, action.pageIndex, action.after);
      return;
  }
}

function replace(
  annotations: HistoryCommandDependencies['annotations'],
  docId: string,
  pageIndex: number,
  annotation: Annotation,
): void {
  annotations.replaceAnnotation(docId, pageIndex, annotation);
}
