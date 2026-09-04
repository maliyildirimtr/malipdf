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
import styles from './PDFPage.module.css';

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
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [renderError, setRenderError] = useState<string | null>(null);

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

    const task = renderPage({ canvas, page, transform });
    renderTaskRef.current = task;
    void task.promise.then(
      () => {
        if (disposed || renderTaskRef.current !== task) return;
        renderTaskRef.current = null;
        setIsLoading(false);
      },
      (error: unknown) => {
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
      task.cancel();
      if (renderTaskRef.current === task) renderTaskRef.current = null;
      // Explicitly release the backing store; CSS slot geometry lives on the parent.
      releaseCanvas(canvas);
    };
  }, [page, transform, renderEnabled]);

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
      <div className={styles.pageSurface} style={{ width, height }}>
        {renderEnabled && transform && (
          <>
            <canvas
              ref={pdfCanvasRef}
              className={styles.pdfCanvas}
              style={{ width, height }}
            />
            <AnnotationCanvas
              docId={docId}
              instanceId={instanceId}
              pageIndex={pageIndex}
              transform={transform}
              onInteractionPinChange={handlePinChange}
            />
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
          </div>
        )}
      </div>

      <div className={styles.pageLabel}>{pageIndex + 1}</div>
    </div>
  );
});

export default PDFPage;
