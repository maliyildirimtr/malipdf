/** Main scrollable document surface with document-scoped page virtualization. */

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { FileText, Upload } from 'lucide-react';
import PDFPage from '../PDFPage/PDFPage';
import { useDocumentStore } from '../../store/documentStore';
import { useAnnotationStore } from '../../store/annotationStore';
import { useHistoryStore } from '../../store/historyStore';
import { useUIStore } from '../../store/uiStore';
import {
  documentSessionStore,
  useDocumentSessionStore,
} from '../../store/documentSessionStore';
import {
  getPage,
  reconcilePageCache,
  requestPageEviction,
} from '../../pdf/documentManager';
import { calcFitPageScale, calcFitWidthScale } from '../../pdf/renderer';
import {
  CANVAS_MEMORY_POLICY,
} from '../../pdf/canvasMemory';
import {
  selectPageLoadCandidates,
  selectRetainedPageIndexes,
} from '../../pdf/pageVirtualization';
import {
  documentIdentityKey,
  sameDocumentIdentity,
  type DocumentIdentity,
  type PageLayout,
} from '../../types/documentSession';
import {
  CANCEL_ACTIVE_INTERACTION_EVENT,
  DOCUMENT_VIEW_COMMAND_EVENT,
  type DocumentViewCommandId,
} from '../../commands';
import { nanoid } from '../../utils/nanoid';
import { openDocumentBytes } from '../../document/openDocumentBytes';
import styles from './DocumentArea.module.css';

export function DocumentArea() {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const pageElementsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const pageObserverRef = useRef<IntersectionObserver | null>(null);
  const visibilityRafRef = useRef<number | null>(null);
  const scrollRafRef = useRef<number | null>(null);
  const visiblePagesRef = useRef<Set<number>>(new Set());
  const [isDragOver, setIsDragOver] = useState(false);
  const isLoadingRef = useRef(false);

  const {
    documents,
    activeDocId,
    openDocument: openDocStore,
    setActivePage,
    setScrollPosition,
    setZoom,
    setZoomMode,
  } = useDocumentStore();
  const { activeTool, temporaryTool } = useUIStore();
  const interactionTool = temporaryTool ?? activeTool;
  const sessionState = useDocumentSessionStore((state) => state);

  const activeDoc = activeDocId ? documents.get(activeDocId) : null;
  const activeIdentity = useMemo<DocumentIdentity | null>(
    () => activeDoc
      ? { docId: activeDoc.id, instanceId: activeDoc.instanceId }
      : null,
    [activeDoc?.id, activeDoc?.instanceId],
  );
  const activeIdentityKey = activeIdentity
    ? documentIdentityKey(activeIdentity)
    : null;
  const activeSession = activeIdentityKey
    ? sessionState.sessions.get(activeIdentityKey) ?? null
    : null;

  // ── File loading ──────────────────────────────────────────────────────────

  const loadFile = useCallback(
    async (name: string, filePath: string | null, data: ArrayBuffer) => {
      if (isLoadingRef.current) return;
      isLoadingRef.current = true;

      try {
        await openDocumentBytes(name, filePath, data);
      } catch (error) {
        console.error('Failed to load PDF:', error);
        alert(`Failed to open PDF: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        isLoadingRef.current = false;
      }
    },
    [],
  );

  const openFileDialog = useCallback(async () => {
    if (!window.electronAPI) return;
    const files = await window.electronAPI.openFile();
    if (!files) return;
    for (const file of files) {
      await loadFile(file.name, file.filePath, file.data);
    }
  }, [loadFile]);

  function onDragOver(event: React.DragEvent) {
    event.preventDefault();
    const hasPdf = Array.from(event.dataTransfer.items).some(
      (item) => item.type === 'application/pdf' || item.kind === 'file',
    );
    if (hasPdf) setIsDragOver(true);
  }

  function onDragLeave(event: React.DragEvent) {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }

  async function onDrop(event: React.DragEvent) {
    event.preventDefault();
    setIsDragOver(false);
    const files = Array.from(event.dataTransfer.files).filter(
      (file) => file.type === 'application/pdf' || file.name.endsWith('.pdf'),
    );
    for (const file of files) {
      await loadFile(file.name, null, await file.arrayBuffer());
    }
  }

  useEffect(() => {
    const handleOpenRequest = () => void openFileDialog();
    document.addEventListener('app:openFile', handleOpenRequest);
    return () => document.removeEventListener('app:openFile', handleOpenRequest);
  }, [openFileDialog]);

  // ── Active session and per-document scroll lifecycle ──────────────────────

  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!activeIdentity || !activeDoc || !container) return;
    const identity = activeIdentity;

    sessionState.setActiveIdentity(identity, activeDoc.activePageIndex, activeDoc.zoom);
    sessionState.setRestoringScroll(identity, true);
    container.scrollTop = activeDoc.scrollTop;
    container.scrollLeft = activeDoc.scrollLeft;

    const restoreRaf = requestAnimationFrame(() => {
      const current = useDocumentStore.getState().documents.get(identity.docId);
      if (!current || current.instanceId !== identity.instanceId || !scrollContainerRef.current) return;
      scrollContainerRef.current.scrollTop = current.scrollTop;
      scrollContainerRef.current.scrollLeft = current.scrollLeft;
      documentSessionStore.getState().setRestoringScroll(identity, false);
    });

    return () => {
      cancelAnimationFrame(restoreRaf);
      if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
      if (scrollContainerRef.current) {
        setScrollPosition(
          identity.docId,
          scrollContainerRef.current.scrollTop,
          scrollContainerRef.current.scrollLeft,
        );
      }
      documentSessionStore.getState().setActiveIdentity(null);
      reconcilePageCache(identity, new Set(), 0);
    };
  }, [activeIdentityKey]); // document switches only; zoom has its own lifecycle

  function onScroll() {
    if (!activeIdentity || scrollRafRef.current !== null) return;
    const identity = activeIdentity;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const session = documentSessionStore.getState().sessions.get(documentIdentityKey(identity));
      const container = scrollContainerRef.current;
      const current = useDocumentStore.getState().documents.get(identity.docId);
      if (!container || !current || current.instanceId !== identity.instanceId || session?.isRestoringScroll) {
        return;
      }
      setScrollPosition(identity.docId, container.scrollTop, container.scrollLeft);
    });
  }

  // ── One observer for all lightweight page slots ───────────────────────────

  const registerPageElement = useCallback((pageIndex: number, element: HTMLDivElement | null) => {
    const previous = pageElementsRef.current.get(pageIndex);
    if (previous) pageObserverRef.current?.unobserve(previous);
    if (element) {
      pageElementsRef.current.set(pageIndex, element);
      pageObserverRef.current?.observe(element);
    } else {
      pageElementsRef.current.delete(pageIndex);
    }
  }, [activeIdentityKey]);

  useEffect(() => {
    const root = scrollContainerRef.current;
    if (!root || !activeIdentity || !activeDoc) return;
    const identity = activeIdentity;
    visiblePagesRef.current = new Set(activeSession?.lastVisiblePages ?? [activeDoc.activePageIndex]);

    const observer = new IntersectionObserver((entries) => {
      const current = useDocumentStore.getState().documents.get(identity.docId);
      if (!current || current.instanceId !== identity.instanceId) return;

      for (const entry of entries) {
        const element = entry.target as HTMLElement;
        if (element.dataset.docId !== identity.docId
          || Number(element.dataset.instanceId) !== identity.instanceId) {
          continue;
        }
        const pageIndex = Number(element.dataset.pageIndex);
        if (entry.isIntersecting) visiblePagesRef.current.add(pageIndex);
        else visiblePagesRef.current.delete(pageIndex);
      }

      if (visibilityRafRef.current !== null) return;
      visibilityRafRef.current = requestAnimationFrame(() => {
        visibilityRafRef.current = null;
        const latest = useDocumentStore.getState().documents.get(identity.docId);
        if (!latest || latest.instanceId !== identity.instanceId) return;
        const visiblePages = new Set(visiblePagesRef.current);
        documentSessionStore.getState().updateVisibility(identity, visiblePages, latest.zoom);
        if (visiblePages.size > 0) {
          setActivePage(identity.docId, Math.min(...visiblePages));
        }
      });
    }, { root, threshold: 0.01 });

    pageObserverRef.current = observer;
    for (const element of pageElementsRef.current.values()) observer.observe(element);

    return () => {
      observer.disconnect();
      if (pageObserverRef.current === observer) pageObserverRef.current = null;
      if (visibilityRafRef.current !== null) {
        cancelAnimationFrame(visibilityRafRef.current);
        visibilityRafRef.current = null;
      }
      visiblePagesRef.current.clear();
    };
  }, [activeIdentityKey]);

  useEffect(() => {
    if (!activeIdentity || !activeDoc || !activeSession) return;
    documentSessionStore.getState().updateVisibility(
      activeIdentity,
      new Set(activeSession.visiblePages),
      activeDoc.zoom,
    );
  }, [activeDoc?.zoom]);

  // ── Identity-safe, bounded page loading ───────────────────────────────────

  useEffect(() => {
    if (!activeIdentity || !activeSession?.active) return;
    const capacity = CANVAS_MEMORY_POLICY.maxConcurrentPageLoads
      - activeSession.pendingLoads.size;
    if (capacity <= 0) return;

    const candidates = selectPageLoadCandidates({
      visiblePages: activeSession.visiblePages,
      renderPages: activeSession.renderPages,
      preloadPages: activeSession.preloadPages,
      pendingPages: new Set(activeSession.pendingLoads.keys()),
      loadedPages: new Set(
        [...activeSession.pages.values()]
          .filter((entry) => !!entry.loadedPage)
          .map((entry) => entry.pageIndex),
      ),
      capacity,
    });

    for (const pageIndex of candidates) {
      const requestId = documentSessionStore.getState().beginPageLoad(activeIdentity, pageIndex);
      if (requestId === null) continue;

      void getPage(activeIdentity, pageIndex, requestId).then(
        (result) => {
          if (!result
            || !sameDocumentIdentity(result.identity, activeIdentity)
            || result.pageIndex !== pageIndex
            || result.requestId !== requestId) {
            documentSessionStore.getState().failPageLoad(activeIdentity, pageIndex, requestId);
            return;
          }
          const committed = documentSessionStore.getState().commitPageLoad(
            activeIdentity,
            pageIndex,
            requestId,
            result.loadedPage,
          );
          if (!committed) requestPageEviction(result.identity, result.pageIndex);
        },
        (error: unknown) => {
          documentSessionStore.getState().failPageLoad(
            activeIdentity,
            pageIndex,
            requestId,
            error instanceof Error ? error.message : String(error),
          );
        },
      );
    }
  }, [activeIdentityKey, activeSession]);

  useEffect(() => {
    if (!activeIdentity || !activeSession?.active) return;
    const retainedPages = selectRetainedPageIndexes({
      renderPages: activeSession.renderPages,
      preloadPages: activeSession.preloadPages,
      pinnedPages: activeSession.pinnedPages,
      entries: [...activeSession.pages.values()]
        .filter((entry) => !!entry.loadedPage)
        .map(({ pageIndex, lastAccess }) => ({ pageIndex, lastAccess })),
      maxRetainedPages: CANVAS_MEMORY_POLICY.maxRetainedPages,
    });
    const evictionRequested = reconcilePageCache(
      activeIdentity,
      retainedPages,
      CANVAS_MEMORY_POLICY.maxRetainedPages,
    );
    const effectiveRetainedPages = new Set(retainedPages);
    for (const pageIndex of evictionRequested) effectiveRetainedPages.delete(pageIndex);
    documentSessionStore.getState().dropPagesExcept(activeIdentity, effectiveRetainedPages);
  }, [activeIdentityKey, activeSession?.renderPages, activeSession?.preloadPages, activeSession?.pinnedPages, activeSession?.pages]);

  const handlePagePinChange = useCallback((pageIndex: number, pinned: boolean) => {
    if (!activeIdentity) return;
    documentSessionStore.getState().setPagePinned(activeIdentity, pageIndex, pinned);
  }, [activeIdentityKey]);

  // ── Fit modes ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!activeDoc || !activeSession || activeDoc.zoomMode !== 'fitWidth') return;
    const pageIndex = activeDoc.activePageIndex;
    const page = activeSession.pages.get(pageIndex)?.loadedPage?.page;
    if (!page || !scrollContainerRef.current) return;
    const newScale = calcFitWidthScale(
      page,
      scrollContainerRef.current.clientWidth,
      activeDoc.pageRotations[pageIndex] || 0,
    );
    if (Math.abs(newScale - activeDoc.zoom) > 0.001) setZoom(activeDoc.id, newScale);
  }, [activeDoc, activeSession, setZoom]);

  // ── Zoom and pan ──────────────────────────────────────────────────────────

  const pendingScrollRef = useRef<{
    identity: DocumentIdentity;
    left: number;
    top: number;
  } | null>(null);

  useEffect(() => {
    const pending = pendingScrollRef.current;
    if (!pending || !activeIdentity || !sameDocumentIdentity(pending.identity, activeIdentity)) return;
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollLeft = pending.left;
      scrollContainerRef.current.scrollTop = pending.top;
    }
    pendingScrollRef.current = null;
  }, [activeDoc?.zoom, activeIdentityKey]);

  function onWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (!activeDoc || !activeIdentity || !(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    const oldZoom = activeDoc.zoom;
    const newZoom = Math.max(0.1, Math.min(8, oldZoom * (1 - event.deltaY * 0.001)));
    if (oldZoom === newZoom) return;

    const container = scrollContainerRef.current;
    if (container) {
      const rect = container.getBoundingClientRect();
      const cursorX = event.clientX - rect.left;
      const cursorY = event.clientY - rect.top;
      const ratio = newZoom / oldZoom;
      pendingScrollRef.current = {
        identity: activeIdentity,
        left: (container.scrollLeft + cursorX) * ratio - cursorX,
        top: (container.scrollTop + cursorY) * ratio - cursorY,
      };
    }
    setZoom(activeDoc.id, newZoom);
    setZoomMode(activeDoc.id, 'custom');
  }

  const isPanningRef = useRef(false);
  const panPointerIdRef = useRef<number | null>(null);
  const lastPanPosRef = useRef({ x: 0, y: 0 });

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (interactionTool !== 'hand' || (event.button !== 0 && event.button !== 1)) return;
    event.preventDefault();
    isPanningRef.current = true;
    panPointerIdRef.current = event.pointerId;
    lastPanPosRef.current = { x: event.clientX, y: event.clientY };
    scrollContainerRef.current?.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!isPanningRef.current || !scrollContainerRef.current) return;
    scrollContainerRef.current.scrollLeft -= event.clientX - lastPanPosRef.current.x;
    scrollContainerRef.current.scrollTop -= event.clientY - lastPanPosRef.current.y;
    lastPanPosRef.current = { x: event.clientX, y: event.clientY };
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (!isPanningRef.current) return;
    isPanningRef.current = false;
    if (scrollContainerRef.current?.hasPointerCapture(event.pointerId)) {
      scrollContainerRef.current.releasePointerCapture(event.pointerId);
    }
    panPointerIdRef.current = null;
  }

  useEffect(() => {
    const cancelPan = (event: Event) => {
      if (!isPanningRef.current) return;
      event.preventDefault();
      isPanningRef.current = false;
      const pointerId = panPointerIdRef.current;
      panPointerIdRef.current = null;
      if (pointerId !== null && scrollContainerRef.current?.hasPointerCapture(pointerId)) {
        scrollContainerRef.current.releasePointerCapture(pointerId);
      }
    };
    document.addEventListener(CANCEL_ACTIVE_INTERACTION_EVENT, cancelPan);
    return () => document.removeEventListener(CANCEL_ACTIVE_INTERACTION_EVENT, cancelPan);
  }, []);

  // ── Document-local view command bridge ───────────────────────────────────

  useEffect(() => {
    if (!activeDocId) return;

    const handleViewCommand = (event: Event) => {
      const commandId = (event as CustomEvent<DocumentViewCommandId>).detail;
      const doc = useDocumentStore.getState().documents.get(activeDocId);
      const session = activeIdentityKey
        ? documentSessionStore.getState().sessions.get(activeIdentityKey)
        : null;
      const pageIndex = doc?.activePageIndex ?? 0;
      const page = session?.pages.get(pageIndex)?.loadedPage?.page;
      if (!doc || !page || !scrollContainerRef.current) return;

      if (commandId === 'view.fitWidth') {
        setZoom(activeDocId, calcFitWidthScale(
          page,
          scrollContainerRef.current.clientWidth,
          doc.pageRotations[pageIndex] || 0,
        ));
        setZoomMode(activeDocId, 'fitWidth');
      } else if (commandId === 'view.fitPage') {
        setZoom(activeDocId, calcFitPageScale(
          page,
          scrollContainerRef.current.clientWidth,
          scrollContainerRef.current.clientHeight,
          doc.pageRotations[pageIndex] || 0,
        ));
        setZoomMode(activeDocId, 'fitPage');
      }
    };

    document.addEventListener(DOCUMENT_VIEW_COMMAND_EVENT, handleViewCommand);
    return () => document.removeEventListener(DOCUMENT_VIEW_COMMAND_EVENT, handleViewCommand);
  }, [activeDocId, activeIdentityKey, setZoom, setZoomMode]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (!activeDoc) {
    return (
      <div
        className={styles.root}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {isDragOver && (
          <div className="drop-overlay">
            <div className="drop-overlay__text">Drop PDF to open</div>
          </div>
        )}
        <div className="empty-state">
          <div className="empty-state__icon"><FileText size={36} /></div>
          <div className="empty-state__title">No document open</div>
          <p className="empty-state__subtitle">
            Open a PDF file to start annotating. You can also drag and drop a PDF anywhere in this window.
          </p>
          <div className="empty-state__actions">
            <button className="btn btn--primary" onClick={openFileDialog}>
              <Upload size={16} />
              Open PDF
            </button>
          </div>
        </div>
      </div>
    );
  }

  const fallbackLayout: PageLayout | null = activeSession
    ? [...activeSession.pages.values()].find((entry) => entry.layout)?.layout ?? null
    : null;

  return (
    <div
      ref={scrollContainerRef}
      className={styles.root}
      style={{ cursor: interactionTool === 'hand' ? (isPanningRef.current ? 'grabbing' : 'grab') : undefined }}
      onScroll={onScroll}
      onWheel={onWheel}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {isDragOver && (
        <div className="drop-overlay">
          <div className="drop-overlay__text">Drop PDF to open</div>
        </div>
      )}

      <div className={styles.pagesContainer}>
        {Array.from({ length: activeDoc.pageCount }, (_, pageIndex) => {
          const entry = activeSession?.pages.get(pageIndex);
          const renderEnabled = activeSession?.renderPages.has(pageIndex) ?? false;
          return (
            <PDFPage
              key={`${activeDoc.id}:${activeDoc.instanceId}:${pageIndex}`}
              docId={activeDoc.id}
              instanceId={activeDoc.instanceId}
              pageIndex={pageIndex}
              page={entry?.loadedPage?.page ?? null}
              layout={entry?.layout ?? null}
              fallbackLayout={fallbackLayout}
              scale={activeDoc.zoom}
              displayRotation={activeDoc.pageRotations[pageIndex] || 0}
              renderEnabled={renderEnabled}
              onSlotElement={registerPageElement}
              onInteractionPinChange={handlePagePinChange}
            />
          );
        })}
      </div>
    </div>
  );
}
