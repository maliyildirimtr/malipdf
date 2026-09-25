/**
 * Pages selected in the thumbnail sidebar, per document identity.
 * Page commands act on this selection, or on the active page when empty.
 */
import { create } from 'zustand';
import { documentIdentityKey, type DocumentIdentity } from '../types/documentSession';

interface PageSelectionStore {
  selections: Map<string, number[]>;
  getPages: (identity: DocumentIdentity) => number[];
  setPages: (identity: DocumentIdentity, pages: number[]) => void;
  clear: (identity: DocumentIdentity) => void;
}

const EMPTY: number[] = [];

export const usePageSelectionStore = create<PageSelectionStore>((set, get) => ({
  selections: new Map(),
  getPages: (identity) => get().selections.get(documentIdentityKey(identity)) ?? EMPTY,
  setPages: (identity, pages) => set((state) => {
    const selections = new Map(state.selections);
    const unique = [...new Set(pages)].sort((a, b) => a - b);
    if (unique.length === 0) selections.delete(documentIdentityKey(identity));
    else selections.set(documentIdentityKey(identity), unique);
    return { selections };
  }),
  clear: (identity) => set((state) => {
    if (!state.selections.has(documentIdentityKey(identity))) return state;
    const selections = new Map(state.selections);
    selections.delete(documentIdentityKey(identity));
    return { selections };
  }),
}));
