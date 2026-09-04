/**
 * PDF Renderer
 *
 * Wraps pdf.js to provide:
 * - Document loading
 * - Page rendering to canvas
 * - Thumbnail rendering
 *
 * Coordinate transforms are in coordinateTransform.ts (canonical module).
 * Use those functions everywhere — do not duplicate transform logic here.
 */

import * as pdfjs from 'pdfjs-dist';
import type {
  PDFDocumentProxy,
  PDFPageProxy,
  PageViewport,
  RenderTask,
} from 'pdfjs-dist';
import type { PageTransform } from './coordinateTransform';
import { computeSafeCanvasOutputScale } from './canvasMemory';

import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Use local worker bundled via Vite to avoid CORS and offline issues in Electron
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// Re-export coordinate helpers for backward compatibility
// All new code should import directly from coordinateTransform.ts
export {
  screenToPdf as screenToPdfPoint,
  pdfToScreen as pdfToScreenPoint,
  screenPointsToPdf,
  pdfPointsToScreen,
  calcFitWidthScale,
  calcFitPageScale,
} from './coordinateTransform';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LoadedPage {
  pageIndex: number;
  page: PDFPageProxy;
  viewport: PageViewport; // At scale=1
  naturalWidth: number;   // PDF page width at scale=1 in CSS pixels
  naturalHeight: number;  // PDF page height at scale=1 in CSS pixels
}

export interface RenderOptions {
  canvas: HTMLCanvasElement;
  page: PDFPageProxy;
  transform: PageTransform;
  /** Requested DPR test seam; production defaults to window.devicePixelRatio. */
  dpr?: number;
}

export interface ThumbnailRender {
  canvas: HTMLCanvasElement;
  task: RenderTask;
}

// ─── Document loading ─────────────────────────────────────────────────────────

export async function loadPdfDocument(data: Uint8Array): Promise<PDFDocumentProxy> {
  const loadingTask = pdfjs.getDocument({
    data: data.slice(0), // Copy to avoid detached buffer issues
    cMapUrl: `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/standard_fonts/`,
  });

  return loadingTask.promise;
}

// ─── Page loading ─────────────────────────────────────────────────────────────

export async function loadPage(
  doc: PDFDocumentProxy,
  pageIndex: number,
): Promise<LoadedPage> {
  // pdf.js uses 1-based page numbers
  const page = await doc.getPage(pageIndex + 1);

  // Omitting rotation preserves the PDF page's intrinsic /Rotate value.
  const viewport = page.getViewport({ scale: 1 });

  return {
    pageIndex,
    page,
    viewport,
    naturalWidth: viewport.width,
    naturalHeight: viewport.height,
  };
}

// ─── Rendering ────────────────────────────────────────────────────────────────

/**
 * Render a PDF page to a canvas.
 *
 * The canvas is sized for HiDPI (devicePixelRatio) rendering.
 * CSS size = naturalWidth * scale
 * Physical pixels = CSS size * devicePixelRatio
 */
export function renderPage(options: RenderOptions): RenderTask {
  const { canvas, page, transform } = options;
  const { viewport, cssWidth, cssHeight } = transform;
  const dpr = computeSafeCanvasOutputScale(
    cssWidth,
    cssHeight,
    options.dpr ?? window.devicePixelRatio ?? 1,
  );

  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;

  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  return page.render({ canvasContext: ctx, viewport });
}

// ─── Thumbnail rendering ──────────────────────────────────────────────────────

export function startThumbnailRender(
  page: PDFPageProxy,
  maxWidth: number,
): ThumbnailRender {
  const naturalViewport = page.getViewport({ scale: 1 });
  const scale = maxWidth / naturalViewport.width;
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  const dpr = computeSafeCanvasOutputScale(
    viewport.width,
    viewport.height,
    window.devicePixelRatio || 1,
  );
  canvas.width = Math.round(viewport.width * dpr);
  canvas.height = Math.round(viewport.height * dpr);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;

  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);

  return {
    canvas,
    task: page.render({ canvasContext: ctx, viewport }),
  };
}

/** Backward-compatible convenience wrapper for non-cancellable callsites. */
export async function renderThumbnail(
  page: PDFPageProxy,
  maxWidth: number,
): Promise<HTMLCanvasElement> {
  const render = startThumbnailRender(page, maxWidth);
  await render.task.promise;
  return render.canvas;
}
