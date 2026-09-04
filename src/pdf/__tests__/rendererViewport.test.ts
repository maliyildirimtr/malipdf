import { describe, expect, it, vi } from 'vitest';
import type { PDFPageProxy, RenderTask } from 'pdfjs-dist';
import { renderPage } from '../renderer';
import type { PageTransform } from '../coordinateTransform';
import { CANVAS_MEMORY_POLICY } from '../canvasMemory';

function makeCanvas() {
  const context = {
    scale: vi.fn(),
    clearRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
  const canvas = {
    width: 0,
    height: 0,
    style: { width: '', height: '' },
    getContext: vi.fn(() => context),
  } as unknown as HTMLCanvasElement;
  return { canvas, context };
}

describe('renderPage PageTransform contract', () => {
  it.each([1, 2])('uses the exact viewport and keeps DPR out of CSS coordinates at DPR=%s', (dpr) => {
    const viewport = { width: 540, height: 648 };
    const transform = {
      viewport,
      cssWidth: viewport.width,
      cssHeight: viewport.height,
      scale: 1,
      intrinsicRotation: 90,
      displayRotation: 270,
      effectiveRotation: 0,
      cropBox: { xMin: 36, yMin: 72, xMax: 576, yMax: 720, width: 540, height: 648 },
      mediaBox: null,
    } as unknown as PageTransform;
    const task = {
      promise: Promise.resolve(),
      cancel: vi.fn(),
    } as unknown as RenderTask;
    const page = {
      render: vi.fn(() => task),
    } as unknown as PDFPageProxy;
    const { canvas, context } = makeCanvas();

    const returnedTask = renderPage({ canvas, page, transform, dpr });

    expect(returnedTask).toBe(task);
    expect(page.render).toHaveBeenCalledWith({ canvasContext: context, viewport });
    expect(canvas.style.width).toBe('540px');
    expect(canvas.style.height).toBe('648px');
    expect(canvas.width).toBe(540 * dpr);
    expect(canvas.height).toBe(648 * dpr);
    returnedTask.cancel();
    expect(task.cancel).toHaveBeenCalledOnce();
  });

  it('keeps the exact viewport while bounding a high-zoom backing buffer', () => {
    const viewport = { width: 4896, height: 6336 };
    const transform = {
      viewport,
      cssWidth: viewport.width,
      cssHeight: viewport.height,
      scale: 8,
      intrinsicRotation: 0,
      displayRotation: 0,
      effectiveRotation: 0,
      cropBox: { xMin: 0, yMin: 0, xMax: 612, yMax: 792, width: 612, height: 792 },
      mediaBox: null,
    } as unknown as PageTransform;
    const task = { promise: Promise.resolve(), cancel: vi.fn() } as unknown as RenderTask;
    const page = { render: vi.fn(() => task) } as unknown as PDFPageProxy;
    const { canvas, context } = makeCanvas();

    renderPage({ canvas, page, transform, dpr: 2 });

    expect(page.render).toHaveBeenCalledWith({ canvasContext: context, viewport });
    expect(canvas.style.width).toBe('4896px');
    expect(canvas.style.height).toBe('6336px');
    expect(canvas.width * canvas.height).toBeLessThanOrEqual(
      CANVAS_MEMORY_POLICY.maxBackingPixels + Math.max(canvas.width, canvas.height),
    );
    expect(canvas.width).toBeLessThanOrEqual(CANVAS_MEMORY_POLICY.maxPhysicalDimension);
    expect(canvas.height).toBeLessThanOrEqual(CANVAS_MEMORY_POLICY.maxPhysicalDimension);
  });
});
