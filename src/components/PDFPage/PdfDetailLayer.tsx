/**
 * Sharp PDF rendering at high zoom.
 *
 * The full-page PDF canvas has to stay within a memory budget, so at high
 * zoom it is rendered below screen resolution (blurry text, jagged lines).
 * This layer re-renders just the visible part of the page at full device
 * resolution on top of it — the same idea as pdf.js's own "detail view".
 */
import { useEffect, useRef } from 'react';
import type { PDFPageProxy, RenderTask } from 'pdfjs-dist';
import type { PageTransform } from '../../pdf/coordinateTransform';
import { computeSafeCanvasOutputScale, releaseCanvas } from '../../pdf/canvasMemory';
import { computeLayerRegion, regionOutputScale, type LayerRegion } from '../../pdf/layerRegion';

const SETTLE_MS = 120;

export function PdfDetailLayer({ page, transform }: { page: PDFPageProxy; transform: PageTransform }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const anchor = anchorRef.current;
    if (!canvas || !anchor) return;
    const deviceRatio = Math.min(window.devicePixelRatio || 1, 3);
    const baseScale = computeSafeCanvasOutputScale(transform.cssWidth, transform.cssHeight, window.devicePixelRatio || 1);
    // The full-page canvas is already sharp: nothing to add.
    if (baseScale >= deviceRatio - 0.05) {
      canvas.style.display = 'none';
      return;
    }

    let region: LayerRegion = { x: 0, y: 0, w: 0, h: 0 };
    let task: RenderTask | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    canvas.style.display = 'none'; // until the first detail render is ready

    const render = (next: LayerRegion) => {
      task?.cancel();
      const scaleOut = regionOutputScale(next.w, next.h);
      const offscreen = document.createElement('canvas');
      offscreen.width = Math.round(next.w * scaleOut);
      offscreen.height = Math.round(next.h * scaleOut);
      const ctx = offscreen.getContext('2d');
      if (!ctx) return;
      const current = page.render({
        canvasContext: ctx,
        viewport: transform.viewport,
        transform: [scaleOut, 0, 0, scaleOut, -next.x * scaleOut, -next.y * scaleOut],
      });
      task = current;
      current.promise.then(
        () => {
          if (disposed || task !== current) return;
          task = null;
          canvas.width = offscreen.width;
          canvas.height = offscreen.height;
          canvas.style.left = `${next.x}px`;
          canvas.style.top = `${next.y}px`;
          canvas.style.width = `${next.w}px`;
          canvas.style.height = `${next.h}px`;
          canvas.getContext('2d')?.drawImage(offscreen, 0, 0);
          canvas.style.display = 'block';
          releaseCanvas(offscreen);
        },
        () => releaseCanvas(offscreen),
      );
    };

    const update = () => {
      timer = null;
      const next = computeLayerRegion(anchor.getBoundingClientRect(), transform.cssWidth, transform.cssHeight, region);
      if (next === region) return;
      region = next;
      render(next);
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(update, SETTLE_MS);
    };

    update();
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      task?.cancel();
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      canvas.style.display = 'none';
      releaseCanvas(canvas);
    };
  }, [page, transform]);

  return (
    <>
      <div ref={anchorRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
      <canvas ref={canvasRef} style={{ position: 'absolute', display: 'none', pointerEvents: 'none' }} />
    </>
  );
}
