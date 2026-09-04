import { describe, expect, it } from 'vitest';
import type { PDFPageProxy, PageViewport } from 'pdfjs-dist';
import { createDocumentSessionStore } from '../documentSessionStore';
import type { DocumentIdentity } from '../../types/documentSession';
import type { LoadedPage } from '../../pdf/renderer';
import { useDocumentStore } from '../documentStore';
import { useAnnotationStore } from '../annotationStore';
import type { DocumentState } from '../../types/annotations';

const A: DocumentIdentity = { docId: 'A', instanceId: 1 };
const B: DocumentIdentity = { docId: 'B', instanceId: 2 };

function loadedPage(pageIndex: number, marker: string): LoadedPage {
  return {
    pageIndex,
    page: {
      rotate: 0,
      getViewport: () => ({ width: 600, height: 800 }) as PageViewport,
      marker,
    } as unknown as PDFPageProxy,
    viewport: { width: 600, height: 800 } as PageViewport,
    naturalWidth: 600,
    naturalHeight: 800,
  };
}

describe('document session store', () => {
  it('isolates page zero for two document instances', () => {
    const store = createDocumentSessionStore();
    const actions = store.getState();
    actions.createSession(A, 10, 0, 1);
    actions.createSession(B, 10, 0, 1);
    actions.setActiveIdentity(A, 0, 1);

    const requestA = store.getState().beginPageLoad(A, 0)!;
    expect(store.getState().commitPageLoad(A, 0, requestA, loadedPage(0, 'A'))).toBe(true);

    actions.setActiveIdentity(B, 0, 1);
    const requestB = store.getState().beginPageLoad(B, 0)!;
    expect(store.getState().commitPageLoad(B, 0, requestB, loadedPage(0, 'B'))).toBe(true);

    const sessions = store.getState().sessions;
    expect(sessions.get('A:1')?.pages.get(0)?.loadedPage).toBeNull();
    expect((sessions.get('B:2')?.pages.get(0)?.loadedPage?.page as any).marker).toBe('B');
  });

  it('rejects a stale load after a tab switch', () => {
    const store = createDocumentSessionStore();
    store.getState().createSession(A, 5, 0, 1);
    store.getState().createSession(B, 5, 0, 1);
    store.getState().setActiveIdentity(A, 0, 1);
    const request = store.getState().beginPageLoad(A, 0)!;

    store.getState().setActiveIdentity(B, 0, 1);

    expect(store.getState().commitPageLoad(A, 0, request, loadedPage(0, 'stale'))).toBe(false);
    expect(store.getState().sessions.get('B:2')?.pages.get(0)?.loadedPage).toBeNull();
  });

  it('rejects a result after the session is closed or replaced by a new instance', () => {
    const store = createDocumentSessionStore();
    store.getState().createSession(A, 5, 0, 1);
    store.getState().setActiveIdentity(A, 0, 1);
    const request = store.getState().beginPageLoad(A, 0)!;
    store.getState().removeSession(A);

    const replacement = { docId: 'A', instanceId: 99 };
    store.getState().createSession(replacement, 5, 0, 1);
    store.getState().setActiveIdentity(replacement, 0, 1);

    expect(store.getState().commitPageLoad(A, 0, request, loadedPage(0, 'old'))).toBe(false);
    expect(store.getState().sessions.get('A:99')?.pages.get(0)?.loadedPage).toBeNull();
  });

  it('stores visible/render/preload state per document', () => {
    const store = createDocumentSessionStore();
    store.getState().createSession(A, 20, 2, 1);
    store.getState().createSession(B, 20, 12, 1);
    store.getState().setActiveIdentity(A, 2, 1);
    store.getState().updateVisibility(A, new Set([2]), 1);
    store.getState().setActiveIdentity(B, 12, 1);
    store.getState().updateVisibility(B, new Set([12]), 1);

    const sessions = store.getState().sessions;
    expect([...sessions.get('A:1')!.lastVisiblePages]).toEqual([2]);
    expect([...sessions.get('B:2')!.visiblePages]).toEqual([12]);
    expect([...sessions.get('B:2')!.renderPages]).toEqual([11, 12, 13]);
  });

  it('releases session resources without changing canonical annotations', () => {
    const store = createDocumentSessionStore();
    store.getState().createSession(A, 5, 0, 1);
    store.getState().setActiveIdentity(A, 0, 1);
    const requestId = store.getState().beginPageLoad(A, 0)!;
    store.getState().commitPageLoad(A, 0, requestId, loadedPage(0, 'A'));

    useAnnotationStore.getState().initDocument(A.docId);
    useAnnotationStore.getState().addAnnotation(A.docId, {
      id: 'annotation-A',
      pageIndex: 0,
      type: 'stroke',
      points: [{ x: 25, y: 75, pressure: 0.5, timestamp: 1 }],
      color: '#000000',
      width: 3,
      opacity: 1,
      smooth: true,
      pressure: true,
      locked: false,
      createdAt: 1,
      updatedAt: 1,
    });

    store.getState().setActiveIdentity(null);
    store.getState().dropPagesExcept(A, new Set());

    expect(store.getState().sessions.get('A:1')?.pages.get(0)?.loadedPage).toBeNull();
    expect(useAnnotationStore.getState().getPageAnnotations(A.docId, 0)).toMatchObject([
      { id: 'annotation-A', points: [{ x: 25, y: 75 }] },
    ]);
    useAnnotationStore.getState().removeDocument(A.docId);
  });

  it('keeps A and B scroll positions independent across A → B → A', () => {
    const makeDocument = (identity: DocumentIdentity): DocumentState => ({
      id: identity.docId,
      instanceId: identity.instanceId,
      title: identity.docId,
      filePath: null,
      isDirty: false,
      sourceData: new Uint8Array(),
      activePageIndex: 0,
      pageCount: 5,
      zoom: 1,
      zoomMode: 'custom',
      scrollTop: 0,
      scrollLeft: 0,
      pageRotations: {},
    });
    useDocumentStore.setState({
      documents: new Map([
        [A.docId, makeDocument(A)],
        [B.docId, makeDocument(B)],
      ]),
      activeDocId: A.docId,
      tabOrder: [A.docId, B.docId],
    });

    useDocumentStore.getState().setScrollPosition(A.docId, 1200, 30);
    useDocumentStore.getState().setActiveDocument(B.docId);
    useDocumentStore.getState().setScrollPosition(B.docId, 440, 8);
    useDocumentStore.getState().setActiveDocument(A.docId);

    expect(useDocumentStore.getState().documents.get(A.docId)).toMatchObject({
      scrollTop: 1200,
      scrollLeft: 30,
    });
    expect(useDocumentStore.getState().documents.get(B.docId)).toMatchObject({
      scrollTop: 440,
      scrollLeft: 8,
    });

    useDocumentStore.setState({ documents: new Map(), activeDocId: null, tabOrder: [] });
  });
});
