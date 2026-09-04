import { create } from 'zustand';
import type { DocumentIdentity } from '../types/documentSession';
import { documentIdentityKey } from '../types/documentSession';

export interface SelectionState {
  pageIndex: number | null;
  selectedIds: string[];
}

interface SelectionStore {
  docSelections: Map<string, SelectionState>;

  /** Selects a single annotation, clearing any previous selection for this document. */
  selectAnnotation: (identity: DocumentIdentity, pageIndex: number, id: string) => void;

  /** Clears the selection for a specific document. */
  clearSelection: (identity: DocumentIdentity) => void;

  /** Sets the selection to a specific set of IDs. */
  setSelection: (identity: DocumentIdentity, pageIndex: number, ids: string[]) => void;

  /** Removes all selection state for a document (used on close). */
  removeDocument: (identity: DocumentIdentity) => void;

  /** Helper to get current selection for a document. */
  getSelection: (identity: DocumentIdentity) => SelectionState | undefined;
}

export const useSelectionStore = create<SelectionStore>((set, get) => ({
  docSelections: new Map(),

  selectAnnotation: (identity, pageIndex, id) => {
    set((state) => {
      const key = documentIdentityKey(identity);
      const newMap = new Map(state.docSelections);
      newMap.set(key, { pageIndex, selectedIds: [id] });
      return { docSelections: newMap };
    });
  },

  clearSelection: (identity) => {
    set((state) => {
      const key = documentIdentityKey(identity);
      if (!state.docSelections.has(key)) return state;
      const newMap = new Map(state.docSelections);
      newMap.delete(key);
      return { docSelections: newMap };
    });
  },

  setSelection: (identity, pageIndex, ids) => {
    set((state) => {
      const key = documentIdentityKey(identity);
      const newMap = new Map(state.docSelections);
      if (ids.length === 0) {
        newMap.delete(key);
      } else {
        newMap.set(key, { pageIndex, selectedIds: ids });
      }
      return { docSelections: newMap };
    });
  },

  removeDocument: (identity) => {
    set((state) => {
      const key = documentIdentityKey(identity);
      if (!state.docSelections.has(key)) return state;
      const newMap = new Map(state.docSelections);
      newMap.delete(key);
      return { docSelections: newMap };
    });
  },

  getSelection: (identity) => {
    return get().docSelections.get(documentIdentityKey(identity));
  },
}));
