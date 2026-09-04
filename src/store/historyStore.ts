import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { HistoryAction, Annotation } from '../types/annotations';
import { nanoid } from '../utils/nanoid';
import { useDocumentStore } from './documentStore';

export type HistoryActionDraft = Omit<HistoryAction, 'beforeStateId' | 'afterStateId'>;

const MAX_HISTORY = 100;

// ─── Per-document history ─────────────────────────────────────────────────────

interface DocumentHistory {
  undoStack: HistoryAction[];
  redoStack: HistoryAction[];
}

// ─── Store interface ──────────────────────────────────────────────────────────

interface HistoryStore {
  histories: Map<string, DocumentHistory>;

  initDocument: (docId: string) => void;
  removeDocument: (docId: string) => void;

  /** Push an action. This clears the redo stack. */
  push: (actionDraft: HistoryActionDraft) => void;

  /** Undo: returns the action to reverse, or null if nothing to undo */
  undo: (docId: string) => HistoryAction | null;

  /** Redo: returns the action to re-apply, or null if nothing to redo */
  redo: (docId: string) => HistoryAction | null;

  canUndo: (docId: string) => boolean;
  canRedo: (docId: string) => boolean;

  /** Clear history for a document (e.g., when saving) */
  clearHistory: (docId: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emptyHistory(): DocumentHistory {
  return { undoStack: [], redoStack: [] };
}

// ─── Store implementation ─────────────────────────────────────────────────────

export const useHistoryStore = create<HistoryStore>()(
  subscribeWithSelector((set, get) => ({
    histories: new Map(),

    initDocument: (docId) => {
      set((state) => {
        if (state.histories.has(docId)) return state;
        const histories = new Map(state.histories);
        histories.set(docId, emptyHistory());
        return { histories };
      });
    },

    removeDocument: (docId) => {
      set((state) => {
        const histories = new Map(state.histories);
        histories.delete(docId);
        return { histories };
      });
    },

    push: (actionDraft) => {
      const { documents, updateDocument } = useDocumentStore.getState();
      const doc = documents.get(actionDraft.docId);
      if (!doc) return;
      
      const beforeStateId = doc.currentStateId;
      const afterStateId = nanoid();
      
      const action: HistoryAction = {
        ...actionDraft,
        beforeStateId,
        afterStateId,
      };

      updateDocument(doc.id, { currentStateId: afterStateId });

      set((state) => {
        const histories = new Map(state.histories);
        const history = histories.get(action.docId) ?? emptyHistory();

        const undoStack = [...history.undoStack, action];
        // Trim to max size
        if (undoStack.length > MAX_HISTORY) {
          undoStack.shift();
        }

        histories.set(action.docId, {
          undoStack,
          redoStack: [], // Clear redo on new action
        });

        return { histories };
      });
    },

    undo: (docId) => {
      const { histories } = get();
      const history = histories.get(docId);
      if (!history || history.undoStack.length === 0) return null;

      const action = history.undoStack[history.undoStack.length - 1];

      useDocumentStore.getState().updateDocument(docId, { currentStateId: action.beforeStateId });

      set((state) => {
        const histories = new Map(state.histories);
        const h = histories.get(docId)!;
        histories.set(docId, {
          undoStack: h.undoStack.slice(0, -1),
          redoStack: [...h.redoStack, action],
        });
        return { histories };
      });

      return action;
    },

    redo: (docId) => {
      const { histories } = get();
      const history = histories.get(docId);
      if (!history || history.redoStack.length === 0) return null;

      const action = history.redoStack[history.redoStack.length - 1];

      useDocumentStore.getState().updateDocument(docId, { currentStateId: action.afterStateId });

      set((state) => {
        const histories = new Map(state.histories);
        const h = histories.get(docId)!;
        histories.set(docId, {
          undoStack: [...h.undoStack, action],
          redoStack: h.redoStack.slice(0, -1),
        });
        return { histories };
      });

      return action;
    },

    canUndo: (docId) => {
      const h = get().histories.get(docId);
      return (h?.undoStack.length ?? 0) > 0;
    },

    canRedo: (docId) => {
      const h = get().histories.get(docId);
      return (h?.redoStack.length ?? 0) > 0;
    },

    clearHistory: (docId) => {
      set((state) => {
        const histories = new Map(state.histories);
        histories.set(docId, emptyHistory());
        return { histories };
      });
    },
  })),
);

// ─── History action creators ──────────────────────────────────────────────────

export function makeAddAction(
  docId: string,
  annotation: Annotation,
): HistoryActionDraft {
  return {
    type: 'ADD_ANNOTATION',
    docId,
    pageIndex: annotation.pageIndex,
    annotationId: annotation.id,
    before: null,
    after: annotation,
  };
}

export function makeRemoveAction(
  docId: string,
  annotation: Annotation,
): HistoryActionDraft {
  return {
    type: 'REMOVE_ANNOTATION',
    docId,
    pageIndex: annotation.pageIndex,
    annotationId: annotation.id,
    before: annotation,
    after: null,
  };
}

export function makeUpdateAction(
  docId: string,
  before: Annotation,
  after: Annotation,
): HistoryActionDraft {
  return {
    type: 'UPDATE_ANNOTATION',
    docId,
    pageIndex: before.pageIndex,
    annotationId: before.id,
    before,
    after,
  };
}

export function makeMoveAction(
  docId: string,
  before: Annotation,
  after: Annotation,
): HistoryActionDraft {
  return {
    type: 'MOVE_ANNOTATION',
    docId,
    pageIndex: before.pageIndex,
    annotationId: before.id,
    before,
    after,
  };
}

export function makeResizeAction(
  docId: string,
  before: Annotation,
  after: Annotation,
): HistoryActionDraft {
  return {
    type: 'RESIZE_ANNOTATION',
    docId,
    pageIndex: before.pageIndex,
    annotationId: before.id,
    before,
    after,
  };
}

