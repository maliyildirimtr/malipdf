import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { LoadedPage } from '../pdf/renderer';
import { computePageWindows } from '../pdf/pageVirtualization';
import {
  documentIdentityKey,
  sameDocumentIdentity,
  type DocumentIdentity,
  type DocumentSession,
  type PageLayout,
  type PageSessionEntry,
} from '../types/documentSession';

export interface DocumentSessionStoreState {
  sessions: Map<string, DocumentSession>;
  activeIdentity: DocumentIdentity | null;
  nextRequestId: number;

  createSession: (
    identity: DocumentIdentity,
    pageCount: number,
    activePageIndex: number,
    zoom: number,
  ) => void;
  removeSession: (identity: DocumentIdentity) => void;
  setActiveIdentity: (
    identity: DocumentIdentity | null,
    activePageIndex?: number,
    zoom?: number,
  ) => void;
  updateVisibility: (identity: DocumentIdentity, visiblePages: Set<number>, zoom: number) => void;
  setPagePinned: (identity: DocumentIdentity, pageIndex: number, pinned: boolean) => void;
  beginPageLoad: (identity: DocumentIdentity, pageIndex: number) => number | null;
  commitPageLoad: (
    identity: DocumentIdentity,
    pageIndex: number,
    requestId: number,
    loadedPage: LoadedPage,
  ) => boolean;
  failPageLoad: (
    identity: DocumentIdentity,
    pageIndex: number,
    requestId: number,
    error?: string,
  ) => void;
  dropPagesExcept: (identity: DocumentIdentity, retainedPages: Set<number>) => void;
  setRestoringScroll: (identity: DocumentIdentity, restoring: boolean) => void;
  reset: () => void;
}

function emptyPageEntry(pageIndex: number): PageSessionEntry {
  return {
    pageIndex,
    status: 'idle',
    requestId: null,
    layout: null,
    loadedPage: null,
    lastAccess: 0,
    error: null,
  };
}

function cloneSession(session: DocumentSession): DocumentSession {
  return {
    ...session,
    pages: new Map(session.pages),
    visiblePages: new Set(session.visiblePages),
    renderPages: new Set(session.renderPages),
    preloadPages: new Set(session.preloadPages),
    pinnedPages: new Set(session.pinnedPages),
    pendingLoads: new Map(session.pendingLoads),
    lastVisiblePages: new Set(session.lastVisiblePages),
  };
}

function ensureWindowEntries(session: DocumentSession): void {
  for (const pageIndex of session.preloadPages) {
    if (!session.pages.has(pageIndex)) {
      session.pages.set(pageIndex, emptyPageEntry(pageIndex));
    }
  }
}

function updateWindows(session: DocumentSession): void {
  const windows = computePageWindows({
    pageCount: session.pageCount,
    activePageIndex: session.activePageIndex,
    visiblePages: session.visiblePages,
    lastVisiblePages: session.lastVisiblePages,
    pinnedPages: session.pinnedPages,
    zoom: session.zoom,
  });
  session.renderPages = windows.renderPages;
  session.preloadPages = windows.preloadPages;
  ensureWindowEntries(session);
}

function releaseHeavySessionState(session: DocumentSession): void {
  session.active = false;
  if (session.visiblePages.size > 0) {
    session.lastVisiblePages = new Set(session.visiblePages);
  }
  session.visiblePages.clear();
  session.renderPages.clear();
  session.preloadPages.clear();
  session.pinnedPages.clear();
  session.pendingLoads.clear();
  session.requestRevision += 1;
  for (const [pageIndex, entry] of session.pages) {
    session.pages.set(pageIndex, {
      ...entry,
      status: 'idle',
      requestId: null,
      loadedPage: null,
      error: null,
    });
  }
}

export function createDocumentSessionStore(): StoreApi<DocumentSessionStoreState> {
  return createStore<DocumentSessionStoreState>((set, get) => ({
    sessions: new Map(),
    activeIdentity: null,
    nextRequestId: 0,

    createSession: (identity, pageCount, activePageIndex, zoom) => {
      set((state) => {
        const sessions = new Map(state.sessions);
        const visiblePages = new Set([activePageIndex]);
        const session: DocumentSession = {
          identity,
          pageCount,
          active: false,
          zoom,
          activePageIndex,
          pages: new Map(),
          visiblePages,
          renderPages: new Set(),
          preloadPages: new Set(),
          pinnedPages: new Set(),
          pendingLoads: new Map(),
          lastVisiblePages: new Set(visiblePages),
          requestRevision: 0,
          isRestoringScroll: false,
        };
        updateWindows(session);
        sessions.set(documentIdentityKey(identity), session);
        return { sessions };
      });
    },

    removeSession: (identity) => {
      set((state) => {
        const key = documentIdentityKey(identity);
        if (!state.sessions.has(key)) return state;
        const sessions = new Map(state.sessions);
        sessions.delete(key);
        return {
          sessions,
          activeIdentity: sameDocumentIdentity(state.activeIdentity, identity)
            ? null
            : state.activeIdentity,
        };
      });
    },

    setActiveIdentity: (identity, activePageIndex, zoom) => {
      set((state) => {
        const sessions = new Map<string, DocumentSession>();
        for (const [key, source] of state.sessions) {
          const session = cloneSession(source);
          if (identity && sameDocumentIdentity(session.identity, identity)) {
            session.active = true;
            session.activePageIndex = activePageIndex ?? session.activePageIndex;
            session.zoom = zoom ?? session.zoom;
            session.visiblePages = new Set(
              session.lastVisiblePages.size > 0
                ? session.lastVisiblePages
                : [session.activePageIndex],
            );
            updateWindows(session);
          } else {
            releaseHeavySessionState(session);
          }
          sessions.set(key, session);
        }
        return { sessions, activeIdentity: identity };
      });
    },

    updateVisibility: (identity, visiblePages, zoom) => {
      set((state) => {
        const key = documentIdentityKey(identity);
        const source = state.sessions.get(key);
        if (!source || !source.active) return state;
        const session = cloneSession(source);
        session.zoom = zoom;
        session.visiblePages = new Set(visiblePages);
        if (visiblePages.size > 0) session.lastVisiblePages = new Set(visiblePages);
        updateWindows(session);
        const sessions = new Map(state.sessions);
        sessions.set(key, session);
        return { sessions };
      });
    },

    setPagePinned: (identity, pageIndex, pinned) => {
      set((state) => {
        const key = documentIdentityKey(identity);
        const source = state.sessions.get(key);
        if (!source || !source.active) return state;
        const session = cloneSession(source);
        if (pinned) session.pinnedPages.add(pageIndex);
        else session.pinnedPages.delete(pageIndex);
        updateWindows(session);
        const sessions = new Map(state.sessions);
        sessions.set(key, session);
        return { sessions };
      });
    },

    beginPageLoad: (identity, pageIndex) => {
      const state = get();
      const key = documentIdentityKey(identity);
      const source = state.sessions.get(key);
      if (!source
        || !source.active
        || !source.preloadPages.has(pageIndex)
        || source.pendingLoads.has(pageIndex)
        || source.pages.get(pageIndex)?.loadedPage) {
        return null;
      }

      const requestId = state.nextRequestId + 1;
      set((current) => {
        const latest = current.sessions.get(key);
        if (!latest || !latest.active || latest.pendingLoads.has(pageIndex)) return current;
        const session = cloneSession(latest);
        const entry = session.pages.get(pageIndex) ?? emptyPageEntry(pageIndex);
        session.pages.set(pageIndex, {
          ...entry,
          status: 'loading',
          requestId,
          error: null,
        });
        session.pendingLoads.set(pageIndex, requestId);
        const sessions = new Map(current.sessions);
        sessions.set(key, session);
        return { sessions, nextRequestId: requestId };
      });
      return requestId;
    },

    commitPageLoad: (identity, pageIndex, requestId, loadedPage) => {
      const state = get();
      const key = documentIdentityKey(identity);
      const source = state.sessions.get(key);
      if (!source
        || !source.active
        || source.pendingLoads.get(pageIndex) !== requestId
        || (!source.preloadPages.has(pageIndex) && !source.pinnedPages.has(pageIndex))) {
        return false;
      }

      const session = cloneSession(source);
      const entry = session.pages.get(pageIndex) ?? emptyPageEntry(pageIndex);
      const intrinsicRotation = (((loadedPage.page.rotate % 360) + 360) % 360) as PageLayout['intrinsicRotation'];
      session.pages.set(pageIndex, {
        ...entry,
        status: 'ready',
        requestId: null,
        loadedPage,
        layout: {
          pageIndex,
          intrinsicWidth: loadedPage.naturalWidth,
          intrinsicHeight: loadedPage.naturalHeight,
          intrinsicRotation,
          measured: true,
        },
        lastAccess: Date.now(),
        error: null,
      });
      session.pendingLoads.delete(pageIndex);
      const sessions = new Map(state.sessions);
      sessions.set(key, session);
      set({ sessions });
      return true;
    },

    failPageLoad: (identity, pageIndex, requestId, error) => {
      set((state) => {
        const key = documentIdentityKey(identity);
        const source = state.sessions.get(key);
        if (!source || source.pendingLoads.get(pageIndex) !== requestId) return state;
        const session = cloneSession(source);
        const entry = session.pages.get(pageIndex) ?? emptyPageEntry(pageIndex);
        session.pages.set(pageIndex, {
          ...entry,
          status: error ? 'error' : 'idle',
          requestId: null,
          loadedPage: null,
          error: error ?? null,
        });
        session.pendingLoads.delete(pageIndex);
        const sessions = new Map(state.sessions);
        sessions.set(key, session);
        return { sessions };
      });
    },

    dropPagesExcept: (identity, retainedPages) => {
      set((state) => {
        const key = documentIdentityKey(identity);
        const source = state.sessions.get(key);
        if (!source) return state;
        const session = cloneSession(source);
        let changed = false;
        for (const [pageIndex, entry] of session.pages) {
          if (retainedPages.has(pageIndex) || !entry.loadedPage) continue;
          session.pages.set(pageIndex, {
            ...entry,
            status: 'idle',
            requestId: null,
            loadedPage: null,
            error: null,
          });
          changed = true;
        }
        if (!changed) return state;
        const sessions = new Map(state.sessions);
        sessions.set(key, session);
        return { sessions };
      });
    },

    setRestoringScroll: (identity, restoring) => {
      set((state) => {
        const key = documentIdentityKey(identity);
        const source = state.sessions.get(key);
        if (!source) return state;
        const sessions = new Map(state.sessions);
        sessions.set(key, { ...source, isRestoringScroll: restoring });
        return { sessions };
      });
    },

    reset: () => set({ sessions: new Map(), activeIdentity: null, nextRequestId: 0 }),
  }));
}

export const documentSessionStore = createDocumentSessionStore();

export function useDocumentSessionStore<T>(
  selector: (state: DocumentSessionStoreState) => T,
): T {
  return useStore(documentSessionStore, selector);
}
