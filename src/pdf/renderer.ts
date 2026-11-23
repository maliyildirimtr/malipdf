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
import { BundledCMapReaderFactory, BundledStandardFontDataFactory } from './pdfjsAssets';
import { isIpadApp } from '../platform/native';

// Use local worker bundled via Vite to avoid CORS and offline issues in Electron
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// On iOS Capacitor (custom URL scheme malipdf://localhost), WKWebView reports
// an opaque ("null") origin and serves .mjs assets without a JS MIME type in
// some Capacitor versions, causing pdf.js module workers to hang or fail.
// Loading the worker via Vite's dynamic ES import (emitted as a standard .js
// chunk) and registering globalThis.pdfjsWorker lets pdf.js run reliably
// offline on iPadOS with zero worker hangs.
let ipadWorkerInit: Promise<void> | null = null;
async function ensurePdfWorkerReady(): Promise<void> {
  if (!isIpadApp()) return;
  const g = globalThis as unknown as { pdfjsWorker?: { WorkerMessageHandler?: unknown } };
  if (g.pdfjsWorker?.WorkerMessageHandler) return;
  if (!ipadWorkerInit) {
    ipadWorkerInit = import('pdfjs-dist/build/pdf.worker.min.mjs')
      .then((mod) => {
        if (mod?.WorkerMessageHandler) {
          g.pdfjsWorker = { WorkerMessageHandler: mod.WorkerMessageHandler };
        }
      })
      .catch((error) => {
        ipadWorkerInit = null;
        console.error('Failed to initialize iPad pdf.js worker module:', error);
      });
  }
  await ipadWorkerInit;
}

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
  await ensurePdfWorkerReady();
  const loadingTask = pdfjs.getDocument({
    data: data.slice(0), // Copy to avoid detached buffer issues
    // CMaps and standard fonts ship with the app (offline, CSP-compatible).
    CMapReaderFactory: BundledCMapReaderFactory as never,
    StandardFontDataFactory: BundledStandardFontDataFactory as never,
    useWorkerFetch: false,
    cMapPacked: true,
    // Never compile PDF-supplied data into JavaScript (defence in depth; the
    // CSP also disallows eval).
    isEvalSupported: false,
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

  // Form fields are drawn by the FormLayer (live values), not on the canvas.
  return page.render({ canvasContext: ctx, viewport, annotationMode: ANNOTATION_MODE_ENABLE_FORMS });
}

/** pdf.js AnnotationMode.ENABLE_FORMS. */
export const ANNOTATION_MODE_ENABLE_FORMS = 2;

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
