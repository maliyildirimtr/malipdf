import { create } from 'zustand';
import type { DocumentIdentity } from '../types/documentSession';
import { documentIdentityKey } from '../types/documentSession';

import type { Annotation } from '../types/annotations';

export interface SelectionState {
  pageIndex: number | null;
  selectedIds: string[];
  transientStyle?: Partial<Annotation>;
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

  /** Sets a transient style override for the currently selected annotation (used for live preview). */
  setTransientStyle: (identity: DocumentIdentity, pageIndex: number, annotationId: string, style: Partial<Annotation> | undefined) => void;

  /** Toggles an annotation in the current selection. */
  toggleSelection: (identity: DocumentIdentity, pageIndex: number, id: string) => void;

  /** Adds an annotation to the current selection. */
  addToSelection: (identity: DocumentIdentity, pageIndex: number, id: string) => void;

  /** Removes an annotation from the current selection. */
  removeFromSelection: (identity: DocumentIdentity, id: string) => void;

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

  setTransientStyle: (identity, pageIndex, annotationId, style) => {
    set((state) => {
      const key = documentIdentityKey(identity);
      const current = state.docSelections.get(key);
      if (!current) return state;
      
      // Strict identity check before applying transient style
      if (current.pageIndex !== pageIndex || !current.selectedIds.includes(annotationId)) {
        return state;
      }

      // React StrictMode runs effect cleanup once during its development probe.
      // Avoid publishing a new store state when there is nothing to clear.
      if (style === undefined && current.transientStyle === undefined) {
        return state;
      }
      
      const newMap = new Map(state.docSelections);
      newMap.set(key, { ...current, transientStyle: style });
      return { docSelections: newMap };
    });
  },

  toggleSelection: (identity, pageIndex, id) => {
    set((state) => {
      const key = documentIdentityKey(identity);
      const current = state.docSelections.get(key);
      const newMap = new Map(state.docSelections);
      
      if (!current || current.pageIndex !== pageIndex) {
        newMap.set(key, { pageIndex, selectedIds: [id] });
      } else {
        const ids = new Set(current.selectedIds);
        if (ids.has(id)) {
          ids.delete(id);
        } else {
          ids.add(id);
        }
        if (ids.size === 0) {
          newMap.delete(key);
        } else {
          newMap.set(key, { pageIndex, selectedIds: Array.from(ids) });
        }
      }
      return { docSelections: newMap };
    });
  },

  addToSelection: (identity, pageIndex, id) => {
    set((state) => {
      const key = documentIdentityKey(identity);
      const current = state.docSelections.get(key);
      const newMap = new Map(state.docSelections);
      
      if (!current || current.pageIndex !== pageIndex) {
        newMap.set(key, { pageIndex, selectedIds: [id] });
      } else {
        const ids = new Set(current.selectedIds);
        if (!ids.has(id)) {
          ids.add(id);
          newMap.set(key, { pageIndex, selectedIds: Array.from(ids) });
        } else {
          return state; // No change
        }
      }
      return { docSelections: newMap };
    });
  },

  removeFromSelection: (identity, id) => {
    set((state) => {
      const key = documentIdentityKey(identity);
      const current = state.docSelections.get(key);
      if (!current) return state;
      
      const ids = new Set(current.selectedIds);
      if (ids.has(id)) {
        ids.delete(id);
        const newMap = new Map(state.docSelections);
        if (ids.size === 0) {
          newMap.delete(key);
        } else {
          newMap.set(key, { ...current, selectedIds: Array.from(ids) });
        }
        return { docSelections: newMap };
      }
      return state;
    });
  },

  getSelection: (identity) => {
    return get().docSelections.get(documentIdentityKey(identity));
  },
}));
