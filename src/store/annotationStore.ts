import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { Annotation, DocumentAnnotationState, PageAnnotationState } from '../types/annotations';

// ─── Store interface ──────────────────────────────────────────────────────────

interface AnnotationStore {
  // Per-document annotation state, keyed by docId
  docAnnotations: Map<string, DocumentAnnotationState>;

  // Actions
  initDocument: (docId: string) => void;
  removeDocument: (docId: string) => void;

  // CRUD
  /** Adds an annotation; `index` inserts at that z-order position (default: top). */
  addAnnotation: (docId: string, annotation: Annotation, index?: number) => void;
  removeAnnotation: (docId: string, pageIndex: number, annotationId: string) => void;
  updateAnnotation: (docId: string, pageIndex: number, annotationId: string, patch: Partial<Annotation>) => void;
  replaceAnnotation: (docId: string, pageIndex: number, annotation: Annotation) => void;

  // Batch
  removeAnnotations: (docId: string, pageIndex: number, ids: string[]) => void;
  /** Replaces a page's annotation list in one update (order = z-order). */
  setPageAnnotations: (docId: string, pageIndex: number, annotations: Annotation[]) => void;

  // Queries
  getPageAnnotations: (docId: string, pageIndex: number) => Annotation[];
  getAnnotation: (docId: string, pageIndex: number, id: string) => Annotation | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getOrCreatePage(
  docState: DocumentAnnotationState,
  pageIndex: number,
): PageAnnotationState {
  if (!docState.pages.has(pageIndex)) {
    docState.pages.set(pageIndex, { pageIndex, annotations: [] });
  }
  return docState.pages.get(pageIndex)!;
}

function cloneDocAnnotations(
  docAnnotations: Map<string, DocumentAnnotationState>,
  docId: string,
): DocumentAnnotationState {
  const existing = docAnnotations.get(docId);
  if (!existing) return { pages: new Map() };
  // Shallow clone the pages map
  return { pages: new Map(existing.pages) };
}

// ─── Store implementation ─────────────────────────────────────────────────────

export const useAnnotationStore = create<AnnotationStore>()(
  subscribeWithSelector((set, get) => ({
    docAnnotations: new Map(),

    initDocument: (docId) => {
      set((state) => {
        if (state.docAnnotations.has(docId)) return state;
        const docs = new Map(state.docAnnotations);
        docs.set(docId, { pages: new Map() });
        return { docAnnotations: docs };
      });
    },

    removeDocument: (docId) => {
      set((state) => {
        const docs = new Map(state.docAnnotations);
        docs.delete(docId);
        return { docAnnotations: docs };
      });
    },

    addAnnotation: (docId, annotation, index) => {
      set((state) => {
        const docs = new Map(state.docAnnotations);
        const docState = cloneDocAnnotations(docs, docId);

        const page = { ...getOrCreatePage(docState, annotation.pageIndex) };
        const annotations = [...page.annotations];
        if (index === undefined || index >= annotations.length) {
          annotations.push(annotation);
        } else {
          annotations.splice(Math.max(0, index), 0, annotation);
        }
        page.annotations = annotations;
        docState.pages.set(annotation.pageIndex, page);
        docs.set(docId, docState);

        return { docAnnotations: docs };
      });
    },

    removeAnnotation: (docId, pageIndex, annotationId) => {
      set((state) => {
        const docs = new Map(state.docAnnotations);
        const docState = cloneDocAnnotations(docs, docId);

        const page = docState.pages.get(pageIndex);
        if (!page) return state;

        const updated = { ...page, annotations: page.annotations.filter((a) => a.id !== annotationId) };
        docState.pages.set(pageIndex, updated);
        docs.set(docId, docState);

        return { docAnnotations: docs };
      });
    },

    updateAnnotation: (docId, pageIndex, annotationId, patch) => {
      set((state) => {
        const docs = new Map(state.docAnnotations);
        const docState = cloneDocAnnotations(docs, docId);

        const page = docState.pages.get(pageIndex);
        if (!page) return state;

        const annotations = page.annotations.map((a) =>
          a.id === annotationId
            ? ({ ...a, ...patch, updatedAt: Date.now() } as Annotation)
            : a,
        );
        docState.pages.set(pageIndex, { ...page, annotations });
        docs.set(docId, docState);

        return { docAnnotations: docs };
      });
    },

    replaceAnnotation: (docId, pageIndex, annotation) => {
      set((state) => {
        const docs = new Map(state.docAnnotations);
        const docState = cloneDocAnnotations(docs, docId);

        const page = docState.pages.get(pageIndex);
        if (!page) return state;

        const annotations = page.annotations.map((a) =>
          a.id === annotation.id ? annotation : a,
        );
        docState.pages.set(pageIndex, { ...page, annotations });
        docs.set(docId, docState);

        return { docAnnotations: docs };
      });
    },

    removeAnnotations: (docId, pageIndex, ids) => {
      set((state) => {
        const docs = new Map(state.docAnnotations);
        const docState = cloneDocAnnotations(docs, docId);

        const page = docState.pages.get(pageIndex);
        if (!page) return state;

        const idSet = new Set(ids);
        const updated = { ...page, annotations: page.annotations.filter((a) => !idSet.has(a.id)) };
        docState.pages.set(pageIndex, updated);
        docs.set(docId, docState);

        return { docAnnotations: docs };
      });
    },

    setPageAnnotations: (docId, pageIndex, annotations) => {
      set((state) => {
        const docs = new Map(state.docAnnotations);
        const docState = cloneDocAnnotations(docs, docId);
        docState.pages.set(pageIndex, { pageIndex, annotations: [...annotations] });
        docs.set(docId, docState);
        return { docAnnotations: docs };
      });
    },

    getPageAnnotations: (docId, pageIndex) => {
      const docState = get().docAnnotations.get(docId);
      if (!docState) return [];
      return docState.pages.get(pageIndex)?.annotations ?? [];
    },

    getAnnotation: (docId, pageIndex, id) => {
      const annotations = get().getPageAnnotations(docId, pageIndex);
      return annotations.find((a) => a.id === id) ?? null;
    },
  })),
);
