/**
 * Lightweight page slot plus virtualized heavy PDF/annotation render layers.
 * PageTransform remains the single coordinate source whenever content is mounted.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PDFPageProxy, RenderTask } from 'pdfjs-dist';
import { renderPage } from '../../pdf/renderer';
import { createPageTransform } from '../../pdf/coordinateTransform';
import { releaseCanvas } from '../../pdf/canvasMemory';
import { getPageSlotSize } from '../../pdf/pageVirtualization';
import type { PageLayout } from '../../types/documentSession';
import AnnotationCanvas from '../AnnotationCanvas/AnnotationCanvas';
import { SearchHighlights } from './SearchHighlights';
import { PdfDetailLayer } from './PdfDetailLayer';
import { FormLayer } from './FormLayer';
import { LinkLayer } from './LinkLayer';
import { useUIStore } from '../../store/uiStore';
import styles from './PDFPage.module.css';

/**
 * A page render that has not finished after this long is treated as stuck:
 * it is cancelled and started again (pdf.js can occasionally leave a render
 * pending forever, e.g. after a cancel/restart race while scrolling fast).
 */
export const PAGE_RENDER_WATCHDOG_MS = 12_000;
/** Automatic restarts before the page shows an error with a Retry button. */
export const PAGE_RENDER_MAX_RETRIES = 2;

interface PDFPageProps {
  docId: string;
  instanceId: number;
  pageIndex: number;
  page: PDFPageProxy | null;
  layout: PageLayout | null;
  fallbackLayout: PageLayout | null;
  scale: number;
  displayRotation?: number;
  renderEnabled: boolean;
  onSlotElement?: (pageIndex: number, element: HTMLDivElement | null) => void;
  onInteractionPinChange?: (pageIndex: number, pinned: boolean) => void;
}

const PDFPage = React.memo<PDFPageProps>(function PDFPage({
  docId,
  instanceId,
  pageIndex,
  page,
  layout,
  fallbackLayout,
  scale,
  displayRotation = 0,
  renderEnabled,
  onSlotElement,
  onInteractionPinChange,
}) {
  const pageTheme = useUIStore((state) => state.pageTheme);
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [renderError, setRenderError] = useState<string | null>(null);
  /** Bumped to start the render again (watchdog restart or Retry button). */
  const [renderAttempt, setRenderAttempt] = useState(0);
  const autoRetriesRef = useRef(0);

  const transform = useMemo(
    () => page && renderEnabled
      ? createPageTransform(page, { scale, displayRotation })
      : null,
    [page, scale, displayRotation, renderEnabled],
  );

  const slotSize = useMemo(
    () => getPageSlotSize(layout, fallbackLayout, scale, displayRotation),
    [layout, fallbackLayout, scale, displayRotation],
  );
  const width = transform?.cssWidth ?? slotSize.width;
  const height = transform?.cssHeight ?? slotSize.height;

  const searchIdentity = useMemo(() => ({ docId, instanceId }), [docId, instanceId]);

  const setSlotRef = useCallback((element: HTMLDivElement | null) => {
    onSlotElement?.(pageIndex, element);
  }, [onSlotElement, pageIndex]);

  useEffect(() => {
    const canvas = pdfCanvasRef.current;
    if (!renderEnabled || !page || !transform || !canvas) {
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
      releaseCanvas(canvas);
      setIsLoading(true);
      setRenderError(null);
      return;
    }

    let disposed = false;
    renderTaskRef.current?.cancel();
    setIsLoading(true);
    setRenderError(null);

    let task: RenderTask;
    try {
      task = renderPage({ canvas, page, transform });
    } catch {
      setRenderError('Failed to render page');
      setIsLoading(false);
      return;
    }
    renderTaskRef.current = task;

    const watchdog = window.setTimeout(() => {
      if (disposed || renderTaskRef.current !== task) return;
      disposed = true;
      task.cancel();
      renderTaskRef.current = null;
      if (autoRetriesRef.current < PAGE_RENDER_MAX_RETRIES) {
        autoRetriesRef.current += 1;
        setRenderAttempt((n) => n + 1);
      } else {
        setRenderError('Page could not be displayed');
        setIsLoading(false);
      }
    }, PAGE_RENDER_WATCHDOG_MS);

    void task.promise.then(
      () => {
        window.clearTimeout(watchdog);
        if (disposed || renderTaskRef.current !== task) return;
        renderTaskRef.current = null;
        autoRetriesRef.current = 0;
        setIsLoading(false);
      },
      (error: unknown) => {
        window.clearTimeout(watchdog);
        if (disposed || (error instanceof Error && error.name === 'RenderingCancelledException')) {
          return;
        }
        if (renderTaskRef.current === task) renderTaskRef.current = null;
        setRenderError('Failed to render page');
        setIsLoading(false);
      },
    );

    return () => {
      disposed = true;
      window.clearTimeout(watchdog);
      task.cancel();
      if (renderTaskRef.current === task) renderTaskRef.current = null;
      // Explicitly release the backing store; CSS slot geometry lives on the parent.
      releaseCanvas(canvas);
    };
  }, [page, transform, renderEnabled, renderAttempt]);

  const handlePinChange = useCallback((pinned: boolean) => {
    onInteractionPinChange?.(pageIndex, pinned);
  }, [onInteractionPinChange, pageIndex]);

  return (
    <div
      ref={setSlotRef}
      className={styles.pageContainer}
      style={{ width, height }}
      data-doc-id={docId}
      data-instance-id={instanceId}
      data-page-index={pageIndex}
    >
      <div className={`${styles.pageSurface} ${pageTheme === 'dark' ? styles.pageDark : pageTheme === 'sepia' ? styles.pageSepia : ''}`} style={{ width, height }}>
        {renderEnabled && transform && (
          <>
            <canvas
              ref={pdfCanvasRef}
              className={styles.pdfCanvas}
              style={{ width, height }}
            />
            {page && !isLoading && <PdfDetailLayer page={page} transform={transform} />}
            <SearchHighlights
              identity={searchIdentity}
              pageIndex={pageIndex}
              transform={transform}
            />
            <AnnotationCanvas
              docId={docId}
              instanceId={instanceId}
              pageIndex={pageIndex}
              transform={transform}
              onInteractionPinChange={handlePinChange}
            />
            {page && !isLoading && <LinkLayer page={page} transform={transform} docId={docId} instanceId={instanceId} />}
            {page && !isLoading && <FormLayer page={page} transform={transform} docId={docId} />}
          </>
        )}

        {renderEnabled && isLoading && !renderError && (
          <div className={styles.loadingOverlay}>
            <div className={styles.loadingSkeleton} />
          </div>
        )}

        {renderEnabled && renderError && (
          <div className={styles.errorOverlay}>
            <span>{renderError}</span>
            <button
              type="button"
              className={styles.retryButton}
              onClick={() => {
                autoRetriesRef.current = 0;
                setRenderAttempt((n) => n + 1);
              }}
            >
              Retry
            </button>
          </div>
        )}
      </div>

      <div className={styles.pageLabel}>{pageIndex + 1}</div>
    </div>
  );
});

export default PDFPage;
