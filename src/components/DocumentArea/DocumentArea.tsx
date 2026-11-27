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
import { isIpadApp } from '../../platform/native';
import { fingerScrollsNow } from '../../platform/touchMode';
import {
  documentSessionStore,
  useDocumentSessionStore,
} from '../../store/documentSessionStore';
import {
  getLoadedRevision,
  getPage,
  reconcilePageCache,
  reloadDocument,
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
import { notifyUser } from '../../utils/notify';
import styles from './DocumentArea.module.css';

export function DocumentArea() {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const pageElementsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const pageObserverRef = useRef<IntersectionObserver | null>(null);
  const visibilityRafRef = useRef<number | null>(null);
  const scrollRafRef = useRef<number | null>(null);
  const visiblePagesRef = useRef<Set<number>>(new Set());
  const [isDragOver, setIsDragOver] = useState(false);
  // Opens run one after another (several files from Finder, Open Recent…).
  const loadQueueRef = useRef<Promise<void>>(Promise.resolve());

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
      // Word / Excel / PowerPoint: converted to a new PDF with LibreOffice.
      if (!/\.pdf$/i.test(name)) {
        const printouts = await import('../../commands/printoutCommands');
        if (printouts.isOfficeFile(name)) {
          await printouts.openOfficeAsDocument(data, name);
          return;
        }
      }
      const run = async () => {
        // The same file is already open: just show its tab.
        const existing = filePath
          ? [...useDocumentStore.getState().documents.values()].find((doc) => doc.filePath === filePath)
          : undefined;
        if (existing) {
          useDocumentStore.getState().setActiveDocument(existing.id);
          return;
        }
        try {
          await openDocumentBytes(name, filePath, data);
        } catch (error) {
          console.error('Failed to load PDF:', error);
          notifyUser('error', `Failed to open ${name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      };
      const next = loadQueueRef.current.then(run);
      loadQueueRef.current = next;
      await next;
    },
    [],
  );

  const openFileDialog = useCallback(async () => {
    if (window.electronAPI?.openFile) {
      const files = await window.electronAPI.openFile('any');
      if (!files) return;
      for (const file of files) {
        await loadFile(file.name, file.filePath, file.data);
      }
      return;
    }

    // Web fallback for browser environment
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf,.pdf';
    input.multiple = true;
    input.style.display = 'none';
    input.onchange = async () => {
      if (!input.files || input.files.length === 0) return;
      for (const file of Array.from(input.files)) {
        const buffer = await file.arrayBuffer();
        await loadFile(file.name, null, buffer);
      }
      input.remove();
    };
    document.body.appendChild(input);
    input.click();
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
    const all = Array.from(event.dataTransfer.files);
    const printouts = await import('../../commands/printoutCommands');
    // Office files are converted to PDF with LibreOffice. Into an open
    // document, presentations come in as printouts and Word/Excel as pages.
    for (const file of all.filter((f) => printouts.isOfficeFile(f.name))) {
      const data = await file.arrayBuffer();
      if (!activeDoc) await printouts.openOfficeAsDocument(data, file.name);
      else if (printouts.isPresentationFile(file.name)) await printouts.insertPptxPrintoutFromBytes(data, file.name);
      else await printouts.insertOfficePagesFromBytes(data, file.name);
    }
    const files = all.filter(
      (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name),
    );
    for (const file of files) {
      if (activeDoc) {
        // A PDF comes in as real pages; only presentations become printouts.
        const { insertPdfPages } = await import('../../commands/pageCommands');
        await insertPdfPages(new Uint8Array(await file.arrayBuffer()), file.name);
      } else {
        await loadFile(file.name, null, await file.arrayBuffer());
      }
    }
  }

  useEffect(() => {
    const handleOpenRequest = () => void openFileDialog();
    document.addEventListener('app:openFile', handleOpenRequest);
    // Files opened from Finder / Explorer / Dock / Open Recent / iPad "Open in MaliPDF".
    const stopOpenFiles = window.electronAPI?.onOpenFiles?.((files) => {
      void (async () => {
        for (const file of files) {
          if (isIpadApp() && file.ephemeral) {
            await openDocumentBytes(file.name, null, file.data, { ephemeralImport: true });
          } else if (isIpadApp()) {
            const { useLibraryStore } = await import('../../store/libraryStore');
            const saved = await useLibraryStore.getState().upsertDocument({
              title: file.name,
              filePath: file.filePath || undefined,
              bytes: new Uint8Array(file.data),
              kind: 'pdf',
              writeBytes: true,
            });
            await loadFile(saved.title, saved.filePath, file.data);
          } else {
            await loadFile(file.name, file.filePath, file.data);
          }
        }
      })();
    });
    window.electronAPI?.readyForFiles?.();
    return () => {
      document.removeEventListener('app:openFile', handleOpenRequest);
      stopOpenFiles?.();
    };
  }, [openFileDialog]);

  // ── Reload source when changed ────────────────────────────────────────────
  // The pdf.js proxy is tracked per document (DocumentManager.loadedRevision),
  // so a page mutation committed while the document was in the background is
  // picked up as soon as it becomes active again.

  useEffect(() => {
    if (!activeIdentity || !activeDoc) return;
    const identity = activeIdentity;
    const revision = activeDoc.sourceRevision;
    if (getLoadedRevision(identity) >= revision) return;

    reloadDocument(identity, activeDoc.sourceData, revision).then((newPageCount) => {
      if (newPageCount === null) return; // superseded by a newer reload
      documentSessionStore.getState().reloadSession(identity, newPageCount);
    }).catch(err => {
      console.error('Failed to reload document bytes:', err);
    });
  }, [activeIdentityKey, activeDoc?.sourceRevision, activeDoc?.sourceData]);

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

  // Refit when the area changes size (window resize, side-by-side pane, sidebar).
  const [containerSize, setContainerSize] = useState('');
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let raf = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setContainerSize(`${el.clientWidth}x${el.clientHeight}`));
    });
    observer.observe(el);
    return () => { observer.disconnect(); cancelAnimationFrame(raf); };
  }, [activeIdentityKey]);

  // Fit Width and Fit Page (the default when a document opens) keep fitting.
  useEffect(() => {
    if (!activeDoc || !activeSession || (activeDoc.zoomMode !== 'fitWidth' && activeDoc.zoomMode !== 'fitPage')) return;
    const pageIndex = activeDoc.activePageIndex;
    const page = activeSession.pages.get(pageIndex)?.loadedPage?.page;
    const container = scrollContainerRef.current;
    if (!page || !container) return;
    const rotation = activeDoc.pageRotations[pageIndex] || 0;
    const newScale = activeDoc.zoomMode === 'fitPage'
      ? calcFitPageScale(page, container.clientWidth, container.clientHeight, rotation)
      : calcFitWidthScale(page, container.clientWidth, rotation);
    if (Math.abs(newScale - activeDoc.zoom) > 0.001) setZoom(activeDoc.id, newScale);
  }, [activeDoc, activeSession, setZoom, containerSize]);

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

  /** Zooms to newZoom keeping the document point under (clientX, clientY) in place. */
  function zoomAt(clientX: number, clientY: number, requestedZoom: number) {
    if (!activeDoc || !activeIdentity) return;
    const oldZoom = activeDoc.zoom;
    const newZoom = Math.max(0.1, Math.min(8, requestedZoom));
    if (oldZoom === newZoom) return;

    const container = scrollContainerRef.current;
    if (container) {
      const rect = container.getBoundingClientRect();
      const cursorX = clientX - rect.left;
      const cursorY = clientY - rect.top;
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

  function onWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (!activeDoc || !activeIdentity || !(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    zoomAt(event.clientX, event.clientY, activeDoc.zoom * (1 - event.deltaY * 0.001));
  }

  // iPad / trackpad pinch (WebKit gesture events): the pages scale live
  // under the fingers and the zoom is applied when the pinch ends.
  const zoomAtRef = useRef(zoomAt);
  zoomAtRef.current = zoomAt;
  const zoomRef = useRef(activeDoc?.zoom ?? 1);
  zoomRef.current = activeDoc?.zoom ?? 1;
  const hasDocument = !!activeDoc;
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || !('ongesturestart' in window)) return;
    type GestureEvent = Event & { scale: number; clientX: number; clientY: number };
    let pinch: { x: number; y: number; scale: number } | null = null;
    const content = () => container.querySelector<HTMLElement>(`.${styles.pagesContainer}`);
    const start = (event: Event) => {
      const e = event as GestureEvent;
      e.preventDefault();
      pinch = { x: e.clientX, y: e.clientY, scale: 1 };
      const pages = content();
      if (pages) {
        const rect = container.getBoundingClientRect();
        pages.style.transformOrigin = `${container.scrollLeft + e.clientX - rect.left - pages.offsetLeft}px ${container.scrollTop + e.clientY - rect.top - pages.offsetTop}px`;
        pages.style.willChange = 'transform';
      }
    };
    const change = (event: Event) => {
      const e = event as GestureEvent;
      e.preventDefault();
      if (!pinch) return;
      const zoom = zoomRef.current;
      pinch.scale = Math.max(0.1 / zoom, Math.min(8 / zoom, e.scale));
      const pages = content();
      if (pages) pages.style.transform = `scale(${pinch.scale})`;
    };
    const end = (event: Event) => {
      event.preventDefault();
      const done = pinch;
      pinch = null;
      const pages = content();
      if (pages) {
        pages.style.transform = '';
        pages.style.transformOrigin = '';
        pages.style.willChange = '';
      }
      if (done && Math.abs(done.scale - 1) > 0.01) zoomAtRef.current(done.x, done.y, zoomRef.current * done.scale);
    };
    container.addEventListener('gesturestart', start);
    container.addEventListener('gesturechange', change);
    container.addEventListener('gestureend', end);
    return () => {
      container.removeEventListener('gesturestart', start);
      container.removeEventListener('gesturechange', change);
      container.removeEventListener('gestureend', end);
    };
  }, [hasDocument]);

  const isPanningRef = useRef(false);
  const panPointerIdRef = useRef<number | null>(null);
  const lastPanPosRef = useRef({ x: 0, y: 0 });

  // Tablet mode on a touch-screen PC: one finger pans, two fingers pinch-zoom
  // (on iPad the system scrolls natively and gesture events zoom).
  const touchPointsRef = useRef(new Map<number, { x: number; y: number }>());
  const touchPinchRef = useRef<{ distance: number; scale: number; x: number; y: number } | null>(null);

  function touchPagesElement(): HTMLElement | null {
    return scrollContainerRef.current?.querySelector<HTMLElement>(`.${styles.pagesContainer}`) ?? null;
  }

  function startTouchPinch() {
    const container = scrollContainerRef.current;
    const [p1, p2] = [...touchPointsRef.current.values()];
    if (!container || !p1 || !p2) return;
    const x = (p1.x + p2.x) / 2;
    const y = (p1.y + p2.y) / 2;
    touchPinchRef.current = { distance: Math.max(1, Math.hypot(p2.x - p1.x, p2.y - p1.y)), scale: 1, x, y };
    const pages = touchPagesElement();
    if (pages) {
      const rect = container.getBoundingClientRect();
      pages.style.transformOrigin = `${container.scrollLeft + x - rect.left - pages.offsetLeft}px ${container.scrollTop + y - rect.top - pages.offsetTop}px`;
      pages.style.willChange = 'transform';
    }
  }

  function endTouchPinch() {
    const pinch = touchPinchRef.current;
    touchPinchRef.current = null;
    const pages = touchPagesElement();
    if (pages) {
      pages.style.transform = '';
      pages.style.transformOrigin = '';
      pages.style.willChange = '';
    }
    if (pinch && activeDoc && Math.abs(pinch.scale - 1) > 0.01) zoomAt(pinch.x, pinch.y, activeDoc.zoom * pinch.scale);
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'touch' && !isIpadApp() && fingerScrollsNow()) {
      event.preventDefault();
      touchPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      scrollContainerRef.current?.setPointerCapture(event.pointerId);
      if (touchPointsRef.current.size === 2) {
        isPanningRef.current = false;
        startTouchPinch();
      } else if (touchPointsRef.current.size === 1) {
        isPanningRef.current = true;
        panPointerIdRef.current = event.pointerId;
        lastPanPosRef.current = { x: event.clientX, y: event.clientY };
      }
      return;
    }
    if (interactionTool !== 'hand' || (event.button !== 0 && event.button !== 1)) return;
    // iOS / iPadOS when native finger scroll is active (or Hand tool): WebKit scrolls natively with momentum.
    if (event.pointerType === 'touch' && isIpadApp() && (fingerScrollsNow() || interactionTool === 'hand')) return;
    event.preventDefault();
    isPanningRef.current = true;
    panPointerIdRef.current = event.pointerId;
    lastPanPosRef.current = { x: event.clientX, y: event.clientY };
    scrollContainerRef.current?.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const touch = touchPointsRef.current.get(event.pointerId);
    if (touch) {
      touch.x = event.clientX;
      touch.y = event.clientY;
      const pinch = touchPinchRef.current;
      if (pinch && touchPointsRef.current.size >= 2 && activeDoc) {
        const [p1, p2] = [...touchPointsRef.current.values()];
        const zoom = activeDoc.zoom;
        pinch.scale = Math.max(0.1 / zoom, Math.min(8 / zoom, Math.hypot(p2.x - p1.x, p2.y - p1.y) / pinch.distance));
        const pages = touchPagesElement();
        if (pages) pages.style.transform = `scale(${pinch.scale})`;
        return;
      }
    }
    if (!isPanningRef.current || !scrollContainerRef.current) return;
    if (touch && panPointerIdRef.current !== event.pointerId) return;
    scrollContainerRef.current.scrollLeft -= event.clientX - lastPanPosRef.current.x;
    scrollContainerRef.current.scrollTop -= event.clientY - lastPanPosRef.current.y;
    lastPanPosRef.current = { x: event.clientX, y: event.clientY };
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (touchPointsRef.current.delete(event.pointerId)) {
      if (scrollContainerRef.current?.hasPointerCapture(event.pointerId)) {
        scrollContainerRef.current.releasePointerCapture(event.pointerId);
      }
      if (touchPinchRef.current && touchPointsRef.current.size < 2) endTouchPinch();
      // One finger left after a pinch: it pans from where it is.
      const [left] = [...touchPointsRef.current.entries()];
      if (left) {
        isPanningRef.current = true;
        panPointerIdRef.current = left[0];
        lastPanPosRef.current = { ...left[1] };
      } else {
        isPanningRef.current = false;
        panPointerIdRef.current = null;
      }
      return;
    }
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
            <div className="drop-overlay__text">Drop a PDF or PowerPoint file to open</div>
          </div>
        )}
        <div className="empty-state">
          <div className="empty-state__icon"><FileText size={36} /></div>
          <div className="empty-state__title">No document open</div>
          <p className="empty-state__subtitle">
            Open a PDF file to start annotating. You can also drag and drop a PDF or PowerPoint file anywhere in this window.
          </p>
          <div className="empty-state__actions">
            <button className="btn btn--primary" onClick={openFileDialog}>
              <Upload size={16} />
              Open PDF
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => useUIStore.getState().setDesktopLibraryOpen(true)}
            >
              <FileText size={16} />
              Library & Cloud
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
      data-document-scroll
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
          <div className="drop-overlay__text">Drop a PDF to add its pages, or a PowerPoint file to add its slides as printout pages</div>
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
