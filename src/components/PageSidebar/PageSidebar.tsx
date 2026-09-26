/** Sidebar panels and identity-safe, bounded page thumbnails. */

import React, { useCallback, useEffect, useRef } from 'react';
import {
  AlignLeft,
  Bookmark,
  Copy,
  Download,
  FileInput,
  FilePlus,
  LayoutGrid,
  MessageSquare,
  RotateCcw,
  RotateCw,
  Search,
  Trash2,
} from 'lucide-react';
import { usePageSelectionStore } from '../../store/pageSelectionStore';
import { AnnotationsPanel } from './AnnotationsPanel';
import { SearchPanel } from './SearchPanel';
import { BookmarksPanel } from './BookmarksPanel';
import { OutlinePanel } from './OutlinePanel';
import {
  deletePages,
  duplicatePages,
  exportSelectedPages,
  insertBlankPage,
  insertPagesFromPdf,
  movePages,
  rotatePages,
} from '../../commands/pageCommands';
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

        {activeSidebarPanel === 'annotations' && activeDoc && (
          <AnnotationsPanel docId={activeDoc.id} />
        )}

        {activeSidebarPanel === 'search' && identity && (
          <SearchPanel identity={identity} />
        )}

        {activeSidebarPanel === 'bookmarks' && activeDoc && (
          <BookmarksPanel docId={activeDoc.id} />
        )}

        {activeSidebarPanel === 'outline' && identity && (
          <OutlinePanel identity={identity} revision={bytesRevision} />
        )}

        {activeSidebarPanel !== 'pages' && !activeDoc && (
          <div className={styles.emptyPanel}><span>No document open</span></div>
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

const PAGE_DRAG_TYPE = 'application/x-malipdf-pages';

function PagesPanel({
  identity,
  pageCount,
  activePage,
  onPageSelect,
  retainThumbnail,
  forgetThumbnail,
}: PagesPanelProps) {
  const selectedPages = usePageSelectionStore(
    (state) => state.selections.get(documentIdentityKey(identity)),
  ) ?? EMPTY_PAGES;
  const setPages = usePageSelectionStore((state) => state.setPages);
  const anchorRef = useRef<number | null>(null);
  const draggingRef = useRef<number[] | null>(null);
  const [dropTarget, setDropTarget] = React.useState<number | null>(null);

  const selected = React.useMemo(() => new Set(selectedPages), [selectedPages]);

  const handleSelect = useCallback((pageIndex: number, event: React.MouseEvent | React.KeyboardEvent) => {
    if (event.shiftKey && anchorRef.current !== null) {
      const [from, to] = [anchorRef.current, pageIndex].sort((a, b) => a - b);
      setPages(identity, Array.from({ length: to - from + 1 }, (_, i) => from + i));
      return;
    }
    if (event.metaKey || event.ctrlKey) {
      const next = new Set(selected);
      if (next.has(pageIndex)) next.delete(pageIndex);
      else next.add(pageIndex);
      anchorRef.current = pageIndex;
      setPages(identity, [...next]);
      return;
    }
    anchorRef.current = pageIndex;
    setPages(identity, [pageIndex]);
    onPageSelect(pageIndex);
  }, [identity, selected, setPages, onPageSelect]);

  const handleDragStart = useCallback((pageIndex: number, event: React.DragEvent) => {
    const pages = selected.has(pageIndex) ? [...selected].sort((a, b) => a - b) : [pageIndex];
    if (!selected.has(pageIndex)) setPages(identity, [pageIndex]);
    draggingRef.current = pages;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(PAGE_DRAG_TYPE, pages.join(','));
  }, [identity, selected, setPages]);

  const handleDragOver = useCallback((pageIndex: number, event: React.DragEvent) => {
    if (!draggingRef.current) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    setDropTarget(pageIndex + (after ? 1 : 0));
  }, []);

  const finishDrag = useCallback(() => {
    draggingRef.current = null;
    setDropTarget(null);
  }, []);

  const handleDrop = useCallback((event: React.DragEvent) => {
    const pages = draggingRef.current;
    const target = dropTarget;
    finishDrag();
    if (!pages || target === null) return;
    event.preventDefault();
    event.stopPropagation();
    void movePages(pages, target);
  }, [dropTarget, finishDrag]);

  const handleListKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      event.stopPropagation();
      void deletePages();
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      event.stopPropagation();
      setPages(identity, Array.from({ length: pageCount }, (_, i) => i));
    }
  }, [identity, pageCount, setPages]);

  const selectionLabel = selectedPages.length > 1 ? `${selectedPages.length} pages` : 'page';

  return (
    <>
      <div className={styles.pageToolbar} role="toolbar" aria-label="Page tools">
        <PageToolButton label="Insert blank page" icon={<FilePlus size={15} />} onClick={() => void insertBlankPage()} />
        <PageToolButton label="Insert pages from PDF…" icon={<FileInput size={15} />} onClick={() => void insertPagesFromPdf()} />
        <PageToolButton label={`Duplicate ${selectionLabel}`} icon={<Copy size={15} />} onClick={() => void duplicatePages()} />
        <PageToolButton label={`Rotate ${selectionLabel} left`} icon={<RotateCcw size={15} />} onClick={() => void rotatePages(-90)} />
        <PageToolButton label={`Rotate ${selectionLabel} right`} icon={<RotateCw size={15} />} onClick={() => void rotatePages(90)} />
        <PageToolButton label={`Export ${selectionLabel}…`} icon={<Download size={15} />} onClick={() => void exportSelectedPages()} />
        <PageToolButton label={`Delete ${selectionLabel}`} icon={<Trash2 size={15} />} onClick={() => void deletePages()} danger />
      </div>
      <div
        className={styles.pagesList}
        onKeyDown={handleListKeyDown}
        onDrop={handleDrop}
        onDragEnd={finishDrag}
        aria-multiselectable="true"
        role="listbox"
        aria-label="Pages"
      >
        {Array.from({ length: pageCount }, (_, pageIndex) => (
          <PageThumbnail
            key={`${documentIdentityKey(identity)}:${pageIndex}`}
            identity={identity}
            pageIndex={pageIndex}
            isActive={pageIndex === activePage}
            isSelected={selected.has(pageIndex)}
            dropIndicator={dropTarget === pageIndex ? 'before' : dropTarget === pageIndex + 1 && pageIndex === pageCount - 1 ? 'after' : null}
            onSelect={(event) => handleSelect(pageIndex, event)}
            onDragStart={(event) => handleDragStart(pageIndex, event)}
            onDragOver={(event) => handleDragOver(pageIndex, event)}
            retainThumbnail={retainThumbnail}
            forgetThumbnail={forgetThumbnail}
          />
        ))}
      </div>
    </>
  );
}

const EMPTY_PAGES: number[] = [];

function PageToolButton({ label, icon, onClick, danger = false }: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={`${styles.pageToolButton} ${danger ? styles.pageToolButtonDanger : ''}`}
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      {icon}
    </button>
  );
}

interface PageThumbnailProps {
  identity: DocumentIdentity;
  pageIndex: number;
  isActive: boolean;
  isSelected: boolean;
  dropIndicator: 'before' | 'after' | null;
  onSelect: (event: React.MouseEvent | React.KeyboardEvent) => void;
  onDragStart: (event: React.DragEvent) => void;
  onDragOver: (event: React.DragEvent) => void;
  retainThumbnail: (key: string, release: ThumbnailRelease) => void;
  forgetThumbnail: (key: string) => void;
}

function PageThumbnail({
  identity,
  pageIndex,
  isActive,
  isSelected,
  dropIndicator,
  onSelect,
  onDragStart,
  onDragOver,
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
      className={[
        styles.thumbnail,
        isActive ? styles.thumbnailActive : '',
        isSelected ? styles.thumbnailSelected : '',
        dropIndicator === 'before' ? styles.dropBefore : '',
        dropIndicator === 'after' ? styles.dropAfter : '',
      ].join(' ')}
      onClick={onSelect}
      role="option"
      tabIndex={0}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onKeyDown={(event) => event.key === 'Enter' && onSelect(event)}
      aria-label={`Page ${pageIndex + 1}`}
      aria-selected={isSelected}
    >
      <div className={styles.thumbnailPage}>
        <canvas ref={canvasRef} className={styles.thumbnailCanvas} />
      </div>
      <span className={styles.thumbnailLabel}>{pageIndex + 1}</span>
    </div>
  );
}
