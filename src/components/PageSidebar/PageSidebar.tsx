/** Sidebar panels and identity-safe, bounded page thumbnails. */

import React, { useCallback, useEffect, useRef } from 'react';
import {
  AlignLeft,
  Bookmark,
  LayoutGrid,
  MessageSquare,
  Search,
} from 'lucide-react';
import type { RenderTask } from 'pdfjs-dist';
import { useUIStore } from '../../store/uiStore';
import { useDocumentStore } from '../../store/documentStore';
import { getPage, requestPageEviction } from '../../pdf/documentManager';
import { startThumbnailRender } from '../../pdf/renderer';
import {
  CANVAS_MEMORY_POLICY,
  CanvasBufferLru,
  releaseCanvas,
} from '../../pdf/canvasMemory';
import { documentSessionStore, useDocumentSessionStore } from '../../store/documentSessionStore';
import {
  documentIdentityKey,
  sameDocumentIdentity,
  type DocumentIdentity,
} from '../../types/documentSession';
import type { SidebarPanel } from '../../types/annotations';
import styles from './PageSidebar.module.css';

const PANELS: { id: SidebarPanel; icon: React.ReactNode; label: string }[] = [
  { id: 'pages', icon: <LayoutGrid size={16} />, label: 'Pages' },
  { id: 'bookmarks', icon: <Bookmark size={16} />, label: 'Bookmarks' },
  { id: 'outline', icon: <AlignLeft size={16} />, label: 'Outline' },
  { id: 'annotations', icon: <MessageSquare size={16} />, label: 'Annotations' },
  { id: 'search', icon: <Search size={16} />, label: 'Search' },
];

type ThumbnailRelease = () => void;

function evictThumbnailOnlyPage(identity: DocumentIdentity, pageIndex: number): void {
  const session = documentSessionStore.getState().sessions.get(documentIdentityKey(identity));
  if (!session?.preloadPages.has(pageIndex) && !session?.pinnedPages.has(pageIndex)) {
    requestPageEviction(identity, pageIndex);
  }
}

export function PageSidebar() {
  const {
    sidebarOpen,
    activeSidebarPanel,
    setActiveSidebarPanel,
    setSidebarOpen,
  } = useUIStore();
  const { documents, activeDocId, setActivePage } = useDocumentStore();
  const activeDoc = activeDocId ? documents.get(activeDocId) : null;
  const retainedThumbnails = useRef<CanvasBufferLru | null>(null);
  if (!retainedThumbnails.current) {
    retainedThumbnails.current = new CanvasBufferLru(
      CANVAS_MEMORY_POLICY.maxThumbnailBuffers,
    );
  }

  const retainThumbnail = useCallback((key: string, release: ThumbnailRelease) => {
    retainedThumbnails.current?.retain(key, release);
  }, []);

  const forgetThumbnail = useCallback((key: string) => {
    retainedThumbnails.current?.forget(key);
  }, []);

  useEffect(() => {
    return () => {
      retainedThumbnails.current?.releaseAll();
    };
  }, [activeDoc?.id, activeDoc?.instanceId]);

  const identity: DocumentIdentity | null = activeDoc
    ? { docId: activeDoc.id, instanceId: activeDoc.instanceId }
    : null;
  // Bumped by documentSessionStore.reloadSession after the pdf.js proxy was
  // rebuilt from new bytes.
  const bytesRevision = useDocumentSessionStore((state) => (
    identity ? state.sessions.get(documentIdentityKey(identity))?.requestRevision ?? 0 : 0
  ));

  return (
    <div className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarExpanded : ''}`}>
      <div className={styles.panelTabs}>
        {PANELS.map((panel) => (
          <button
            key={panel.id}
            className={`${styles.panelTab} ${sidebarOpen && activeSidebarPanel === panel.id ? styles.panelTabActive : ''}`}
            onClick={() => {
              if (sidebarOpen && activeSidebarPanel === panel.id) {
                setSidebarOpen(false);
              } else {
                setActiveSidebarPanel(panel.id);
                setSidebarOpen(true);
              }
            }}
            title={panel.label}
            aria-label={panel.label}
            aria-pressed={sidebarOpen && activeSidebarPanel === panel.id}
          >
            {panel.icon}
          </button>
        ))}
      </div>

      {sidebarOpen && <div className={styles.panelContent}>
        {activeSidebarPanel === 'pages' && activeDoc && identity && (
          <PagesPanel
            // Remount thumbnails when the PDF bytes were reloaded (page insertion,
            // undo/redo of one) so no page shows another page's stale image.
            key={`${documentIdentityKey(identity)}:${bytesRevision}`}
            identity={identity}
            pageCount={activeDoc.pageCount}
            activePage={activeDoc.activePageIndex}
            retainThumbnail={retainThumbnail}
            forgetThumbnail={forgetThumbnail}
            onPageSelect={(pageIndex) => {
              setActivePage(activeDoc.id, pageIndex);
              document.querySelector(
                `[data-doc-id="${activeDoc.id}"][data-instance-id="${activeDoc.instanceId}"][data-page-index="${pageIndex}"]`,
              )?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
          />
        )}

        {activeSidebarPanel === 'pages' && !activeDoc && (
          <div className={styles.emptyPanel}><span>No document open</span></div>
        )}

        {activeSidebarPanel !== 'pages' && (
          <div className={styles.emptyPanel}>
            <span>{PANELS.find((panel) => panel.id === activeSidebarPanel)?.label}</span>
            <span style={{ fontSize: 11, opacity: 0.5 }}>Coming soon</span>
          </div>
        )}
      </div>}
    </div>
  );
}

interface PagesPanelProps {
  identity: DocumentIdentity;
  pageCount: number;
  activePage: number;
  onPageSelect: (pageIndex: number) => void;
  retainThumbnail: (key: string, release: ThumbnailRelease) => void;
  forgetThumbnail: (key: string) => void;
}

function PagesPanel({
  identity,
  pageCount,
  activePage,
  onPageSelect,
  retainThumbnail,
  forgetThumbnail,
}: PagesPanelProps) {
  return (
    <div className={styles.pagesList}>
      {Array.from({ length: pageCount }, (_, pageIndex) => (
        <PageThumbnail
          key={`${documentIdentityKey(identity)}:${pageIndex}`}
          identity={identity}
          pageIndex={pageIndex}
          isActive={pageIndex === activePage}
          onSelect={() => onPageSelect(pageIndex)}
          retainThumbnail={retainThumbnail}
          forgetThumbnail={forgetThumbnail}
        />
      ))}
    </div>
  );
}

interface PageThumbnailProps {
  identity: DocumentIdentity;
  pageIndex: number;
  isActive: boolean;
  onSelect: () => void;
  retainThumbnail: (key: string, release: ThumbnailRelease) => void;
  forgetThumbnail: (key: string) => void;
}

function PageThumbnail({
  identity,
  pageIndex,
  isActive,
  onSelect,
  retainThumbnail,
  forgetThumbnail,
}: PageThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const requestIdRef = useRef(0);
  const loadingRef = useRef(false);
  const renderedRef = useRef(false);
  const retainedKey = `${documentIdentityKey(identity)}:${pageIndex}`;

  const releaseBuffer = useCallback(() => {
    requestIdRef.current += 1;
    loadingRef.current = false;
    renderedRef.current = false;
    renderTaskRef.current?.cancel();
    renderTaskRef.current = null;
    releaseCanvas(canvasRef.current);
  }, []);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    let disposed = false;

    const render = async () => {
      if (loadingRef.current) return;
      if (renderedRef.current) {
        retainThumbnail(retainedKey, releaseBuffer);
        return;
      }
      loadingRef.current = true;
      const requestId = ++requestIdRef.current;
      let loadedForThumbnail = false;
      let temporaryCanvas: HTMLCanvasElement | null = null;

      try {
        const result = await getPage(identity, pageIndex, requestId);
        loadedForThumbnail = !!result;
        if (disposed
          || requestIdRef.current !== requestId
          || !result
          || !sameDocumentIdentity(result.identity, identity)
          || result.pageIndex !== pageIndex
          || result.requestId !== requestId) {
          return;
        }

        const thumbnail = startThumbnailRender(result.loadedPage.page, 160);
        temporaryCanvas = thumbnail.canvas;
        renderTaskRef.current = thumbnail.task;
        await thumbnail.task.promise;
        if (disposed || requestIdRef.current !== requestId || !canvasRef.current) {
          return;
        }

        const canvas = canvasRef.current;
        canvas.width = thumbnail.canvas.width;
        canvas.height = thumbnail.canvas.height;
        canvas.style.width = thumbnail.canvas.style.width;
        canvas.style.height = thumbnail.canvas.style.height;
        canvas.getContext('2d')?.drawImage(thumbnail.canvas, 0, 0);
        renderTaskRef.current = null;
        renderedRef.current = true;
        retainThumbnail(retainedKey, releaseBuffer);
      } catch (error) {
        if (!(error instanceof Error && error.name === 'RenderingCancelledException')) {
          console.warn('Failed to render page thumbnail:', error);
        }
      } finally {
        releaseCanvas(temporaryCanvas);
        if (loadedForThumbnail) evictThumbnailOnlyPage(identity, pageIndex);
        if (requestIdRef.current === requestId) {
          loadingRef.current = false;
          renderTaskRef.current = null;
        }
      }
    };

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) void render();
    }, { rootMargin: '200px' });
    observer.observe(element);

    return () => {
      disposed = true;
      observer.disconnect();
      forgetThumbnail(retainedKey);
      releaseBuffer();
    };
  }, [identity.docId, identity.instanceId, pageIndex, retainedKey, retainThumbnail, forgetThumbnail, releaseBuffer]);

  return (
    <div
      ref={containerRef}
      className={`${styles.thumbnail} ${isActive ? styles.thumbnailActive : ''}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => event.key === 'Enter' && onSelect()}
      aria-label={`Page ${pageIndex + 1}`}
      aria-pressed={isActive}
    >
      <div className={styles.thumbnailPage}>
        <canvas ref={canvasRef} className={styles.thumbnailCanvas} />
      </div>
      <span className={styles.thumbnailLabel}>{pageIndex + 1}</span>
    </div>
  );
}
