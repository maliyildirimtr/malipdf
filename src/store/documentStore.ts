import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type {
  DocumentState,
  ZoomMode,
} from '../types/annotations';
import { normalizeRotation } from '../pdf/coordinateTransform';

// ─── Store interface ──────────────────────────────────────────────────────────

interface DocumentStore {
  // All open documents, keyed by id
  documents: Map<string, DocumentState>;
  // Currently active document id
  activeDocId: string | null;
  // Ordered list of tab IDs (for display order)
  tabOrder: string[];

  // Actions
  openDocument: (doc: DocumentState) => void;
  closeDocument: (docId: string) => void;
  setActiveDocument: (docId: string) => void;
  updateDocument: (docId: string, patch: Partial<DocumentState>) => void;

  // Zoom helpers
  setZoom: (docId: string, zoom: number) => void;
  setZoomMode: (docId: string, mode: ZoomMode) => void;

  // Page navigation
  setActivePage: (docId: string, pageIndex: number) => void;
  setScrollPosition: (docId: string, top: number, left: number) => void;

  // Page manipulation
  rotatePage: (docId: string, pageIndex: number, delta90: number) => void;

  // Derived helpers
  activeDocument: () => DocumentState | null;
}

// ─── Store implementation ─────────────────────────────────────────────────────

export const useDocumentStore = create<DocumentStore>()(
  subscribeWithSelector((set, get) => ({
    documents: new Map(),
    activeDocId: null,
    tabOrder: [],

    openDocument: (doc) => {
      set((state) => {
        const docs = new Map(state.documents);
        docs.set(doc.id, { ...doc, pageRotations: {} });
        return {
          documents: docs,
          activeDocId: doc.id,
          tabOrder: [...state.tabOrder, doc.id],
        };
      });
    },

    closeDocument: (docId) => {
      set((state) => {
        const docs = new Map(state.documents);
        docs.delete(docId);

        const newTabOrder = state.tabOrder.filter((id) => id !== docId);
        let newActiveId = state.activeDocId;

        if (state.activeDocId === docId) {
          // Select adjacent tab
          const closedIdx = state.tabOrder.indexOf(docId);
          const nextIdx = Math.min(closedIdx, newTabOrder.length - 1);
          newActiveId = newTabOrder[nextIdx] ?? null;
        }

        return {
          documents: docs,
          tabOrder: newTabOrder,
          activeDocId: newActiveId,
        };
      });
    },

    setActiveDocument: (docId) => {
      if (get().documents.has(docId)) set({ activeDocId: docId });
    },

    updateDocument: (docId, patch) => {
      set((state) => {
        const doc = state.documents.get(docId);
        if (!doc) return state;
        const docs = new Map(state.documents);
        docs.set(docId, { ...doc, ...patch });
        return { documents: docs };
      });
    },

    setZoom: (docId, zoom) => {
      get().updateDocument(docId, { zoom: Math.max(0.1, Math.min(8, zoom)), zoomMode: 'custom' });
    },

    setZoomMode: (docId, mode) => {
      get().updateDocument(docId, { zoomMode: mode });
    },

    setActivePage: (docId, pageIndex) => {
      get().updateDocument(docId, { activePageIndex: pageIndex });
    },

    setScrollPosition: (docId, top, left) => {
      get().updateDocument(docId, { scrollTop: top, scrollLeft: left });
    },

    rotatePage: (docId, pageIndex, delta90) => {
      set((state) => {
        const doc = state.documents.get(docId);
        if (!doc) return state;
        
        const currentRot = doc.pageRotations[pageIndex] || 0;
        const newRot = normalizeRotation(currentRot + delta90 * 90);
        
        const newRotations = { ...doc.pageRotations, [pageIndex]: newRot };
        
        const docs = new Map(state.documents);
        docs.set(docId, { ...doc, pageRotations: newRotations });
        
        return { documents: docs };
      });
    },

    activeDocument: () => {
      const { documents, activeDocId } = get();
      if (!activeDocId) return null;
      return documents.get(activeDocId) ?? null;
    },
  })),
);
