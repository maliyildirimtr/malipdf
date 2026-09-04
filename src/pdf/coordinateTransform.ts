/**
 * Canonical PDF coordinate and viewport model.
 *
 * Annotation geometry is stored in canonical PDF User Space. Coordinates are
 * never normalized to the CropBox origin and never contain zoom, DPR, or
 * display-rotation state. A PageTransform owns the single pdf.js PageViewport
 * used by base rendering, annotation rendering, input, and hit testing.
 */

import type { PDFPageProxy, PageViewport } from 'pdfjs-dist';
import type { InputPoint, PdfPoint, PdfRect } from '../types/annotations';

export type QuarterTurn = 0 | 90 | 180 | 270;

export interface PdfBox {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  width: number;
  height: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfLibPoint {
  x: number;
  y: number;
}

export interface PageTransform {
  readonly intrinsicRotation: QuarterTurn;
  /** Additional user display rotation, not an absolute page rotation. */
  readonly displayRotation: QuarterTurn;
  readonly effectiveRotation: QuarterTurn;
  /** Effective visible page box reported by pdf.js page.view. */
  readonly cropBox: PdfBox;
  /** Raw MediaBox metadata when supplied by the document metadata boundary. */
  readonly mediaBox: PdfBox | null;
  readonly viewport: PageViewport;
  readonly scale: number;
  readonly cssWidth: number;
  readonly cssHeight: number;
}

export interface CreatePageTransformOptions {
  scale: number;
  displayRotation?: number;
  mediaBox?: PdfBox | null;
}

export function normalizeRotation(rotation: number): QuarterTurn {
  if (!Number.isFinite(rotation) || rotation % 90 !== 0) {
    throw new Error(`Rotation must be a finite multiple of 90 degrees; received ${rotation}.`);
  }
  return (((rotation % 360) + 360) % 360) as QuarterTurn;
}

export function createPageTransform(
  page: PDFPageProxy,
  options: CreatePageTransformOptions,
): PageTransform {
  const { scale } = options;
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error(`PageTransform scale must be a positive finite number; received ${scale}.`);
  }

  const intrinsicRotation = normalizeRotation(page.rotate);
  const displayRotation = normalizeRotation(options.displayRotation ?? 0);
  const effectiveRotation = normalizeRotation(intrinsicRotation + displayRotation);
  const cropBox = pdfBoxFromView(page.view);
  const mediaBox = options.mediaBox ? normalizePdfBox(options.mediaBox) : null;
  const viewport = page.getViewport({ scale, rotation: effectiveRotation });

  return {
    intrinsicRotation,
    displayRotation,
    effectiveRotation,
    cropBox,
    mediaBox,
    viewport,
    scale,
    cssWidth: viewport.width,
    cssHeight: viewport.height,
  };
}

export function screenToPdf(
  screenX: number,
  screenY: number,
  transform: PageTransform,
): PdfPoint {
  const [x, y] = transform.viewport.convertToPdfPoint(screenX, screenY);
  return { x, y };
}

export function pdfToScreen(
  pdfX: number,
  pdfY: number,
  transform: PageTransform,
): ScreenPoint {
  const [x, y] = transform.viewport.convertToViewportPoint(pdfX, pdfY);
  return { x, y };
}

export function screenPointsToPdf(
  points: InputPoint[],
  transform: PageTransform,
): InputPoint[] {
  return points.map((point) => {
    const { x, y } = screenToPdf(point.x, point.y, transform);
    return { ...point, x, y };
  });
}

export function pdfPointsToScreen(
  points: InputPoint[],
  transform: PageTransform,
): InputPoint[] {
  return points.map((point) => {
    const { x, y } = pdfToScreen(point.x, point.y, transform);
    return { ...point, x, y };
  });
}

/** Transform all four PDF rectangle corners and return normalized screen bounds. */
export function pdfRectToScreenBounds(rect: PdfRect, transform: PageTransform): ScreenRect {
  const x2 = rect.x + rect.width;
  const y2 = rect.y + rect.height;
  return pointsToBounds([
    pdfToScreen(rect.x, rect.y, transform),
    pdfToScreen(x2, rect.y, transform),
    pdfToScreen(rect.x, y2, transform),
    pdfToScreen(x2, y2, transform),
  ]);
}

/** Transform all four screen rectangle corners and return normalized PDF bounds. */
export function screenRectToPdfBounds(rect: ScreenRect, transform: PageTransform): PdfRect {
  const x2 = rect.x + rect.width;
  const y2 = rect.y + rect.height;
  return pointsToBounds([
    screenToPdf(rect.x, rect.y, transform),
    screenToPdf(x2, rect.y, transform),
    screenToPdf(rect.x, y2, transform),
    screenToPdf(x2, y2, transform),
  ]);
}

function pdfBoxFromView(view: number[]): PdfBox {
  if (view.length !== 4 || view.some((value) => !Number.isFinite(value))) {
    throw new Error('PDF page view must contain four finite coordinates.');
  }
  return normalizePdfBox({
    xMin: view[0],
    yMin: view[1],
    xMax: view[2],
    yMax: view[3],
    width: view[2] - view[0],
    height: view[3] - view[1],
  });
}

function normalizePdfBox(box: PdfBox): PdfBox {
  const values = [box.xMin, box.yMin, box.xMax, box.yMax];
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error('PDF box coordinates must be finite.');
  }
  const xMin = Math.min(box.xMin, box.xMax);
  const yMin = Math.min(box.yMin, box.yMax);
  const xMax = Math.max(box.xMin, box.xMax);
  const yMax = Math.max(box.yMin, box.yMax);
  if (xMax === xMin || yMax === yMin) {
    throw new Error('PDF box must have positive width and height.');
  }
  return { xMin, yMin, xMax, yMax, width: xMax - xMin, height: yMax - yMin };
}

function pointsToBounds(points: Array<{ x: number; y: number }>): PdfRect {
  const { minX, minY, maxX, maxY } = pointsBoundingBox(points);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function calcFitWidthScale(
  page: PDFPageProxy,
  containerWidth: number,
  displayRotation: number = 0,
  padding: number = 48,
): number {
  const transform = createPageTransform(page, { scale: 1, displayRotation });
  return (containerWidth - padding * 2) / transform.cssWidth;
}

export function calcFitPageScale(
  page: PDFPageProxy,
  containerWidth: number,
  containerHeight: number,
  displayRotation: number = 0,
  padding: number = 48,
): number {
  const transform = createPageTransform(page, { scale: 1, displayRotation });
  const scaleW = (containerWidth - padding * 2) / transform.cssWidth;
  const scaleH = (containerHeight - padding * 2) / transform.cssHeight;
  return Math.min(scaleW, scaleH);
}

/**
 * Legacy exporter boundary. Phase 1 deliberately leaves exporter behavior
 * unchanged; it must not be used for screen/PDF viewport conversion.
 */
export function pdfUserSpaceToLibPoint(
  pdfX: number,
  pdfY: number,
  rotation: number,
  unrotatedWidth: number,
  unrotatedHeight: number,
): PdfLibPoint {
  // Preserve the pre-Phase-1 exporter behavior. Export rotation correctness is
  // intentionally deferred and is not part of the PageTransform contract.
  const normalized = ((rotation % 360) + 360) % 360;
  switch (normalized) {
    case 0:
      return { x: pdfX, y: pdfY };
    case 90:
      return { x: pdfY, y: unrotatedHeight - pdfX };
    case 180:
      return { x: unrotatedWidth - pdfX, y: unrotatedHeight - pdfY };
    case 270:
      return { x: unrotatedWidth - pdfY, y: pdfX };
    default:
      return { x: pdfX, y: pdfY };
  }
}

export function pdfDimensionToLib(pdfDimension: number): number {
  return pdfDimension;
}

export function pointsBoundingBox(
  points: Array<{ x: number; y: number }>,
): { minX: number; minY: number; maxX: number; maxY: number } {
  if (points.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}
