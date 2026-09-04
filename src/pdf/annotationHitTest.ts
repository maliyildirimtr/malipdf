/**
 * annotationHitTest.ts — Type-aware annotation hit testing
 *
 * All hit testing is performed in PDF User Space (annotation coordinate system).
 * This ensures correctness at all zoom levels.
 *
 * Hit testing strategy by annotation type:
 *   stroke    → proximity to each line segment (distance-to-segment)
 *   highlight → proximity to each line segment (distance-to-segment)
 *   text      → point-in-rectangle (bounding rect)
 *   shape     → type-specific geometry testing
 *
 * Input: PDF User Space point (from screenToPdf transform)
 * Output: annotation id or null
 */

import type {
  Annotation,
  StrokeAnnotation,
  HighlightAnnotation,
  TextAnnotation,
  ShapeAnnotation,
  InputPoint,
  PdfPoint,
  PdfRect,
} from '../types/annotations';
import { pointsBoundingBox, type PageTransform } from './coordinateTransform';

// ─── Hit tolerance ─────────────────────────────────────────────────────────────

/**
 * Returns the hit tolerance in PDF points for a given scale.
 * We keep a constant CSS pixel tolerance (8px) converted to PDF space.
 */
export function getHitTolerance(transform: PageTransform): number {
  // 8 CSS pixels / scale → PDF point tolerance
  // Minimum 4pt to remain usable at high zoom
  return Math.max(4, 8 / transform.scale);
}

// ─── Main hit test function ────────────────────────────────────────────────────

/**
 * Find the topmost annotation at a given PDF User Space point.
 * Returns the annotation (last = topmost in render order) or null.
 *
 * @param pdfPoint   - Point in PDF User Space
 * @param annotations - Annotation array for this page (ordered bottom to top)
 * @param transform  - Canonical page transform (for tolerance calculation)
 */
export function hitTestAnnotations(
  pdfPoint: PdfPoint,
  annotations: Annotation[],
  transform: PageTransform,
): Annotation | null {
  const tolerance = getHitTolerance(transform);

  // Iterate in reverse so topmost (last drawn) is found first
  for (let i = annotations.length - 1; i >= 0; i--) {
    const ann = annotations[i];
    if (ann.locked) continue;

    if (hitTestAnnotation(pdfPoint, ann, tolerance)) {
      return ann;
    }
  }
  return null;
}

/**
 * Test a single annotation for a hit.
 */
export function hitTestAnnotation(
  pdfPoint: PdfPoint,
  annotation: Annotation,
  tolerance: number,
): boolean {
  switch (annotation.type) {
    case 'stroke':
      return hitTestStroke(pdfPoint, annotation, tolerance);
    case 'highlight':
      return hitTestHighlight(pdfPoint, annotation, tolerance);
    case 'text':
      return hitTestText(pdfPoint, annotation);
    case 'shape':
      return hitTestShape(pdfPoint, annotation, tolerance);
    default:
      return false;
  }
}

// ─── Stroke hit test ──────────────────────────────────────────────────────────

function hitTestStroke(
  pt: PdfPoint,
  annotation: StrokeAnnotation,
  tolerance: number,
): boolean {
  const { points } = annotation;
  // Half the stroke width in PDF space + tolerance
  const halfWidth = (annotation.width / 2) + tolerance;

  for (let i = 0; i < points.length - 1; i++) {
    if (distanceToSegment(pt, points[i], points[i + 1]) <= halfWidth) {
      return true;
    }
  }
  return false;
}

// ─── Highlight hit test ───────────────────────────────────────────────────────

function hitTestHighlight(
  pt: PdfPoint,
  annotation: HighlightAnnotation,
  tolerance: number,
): boolean {
  const { points } = annotation;
  const halfWidth = (annotation.width / 2) + tolerance;

  for (let i = 0; i < points.length - 1; i++) {
    if (distanceToSegment(pt, points[i], points[i + 1]) <= halfWidth) {
      return true;
    }
  }
  return false;
}

// ─── Text hit test ────────────────────────────────────────────────────────────

function hitTestText(pt: PdfPoint, annotation: TextAnnotation): boolean {
  return pointInRect(pt, annotation.bounds);
}

// ─── Shape hit test ───────────────────────────────────────────────────────────

function hitTestShape(
  pt: PdfPoint,
  annotation: ShapeAnnotation,
  tolerance: number,
): boolean {
  const { startPoint, endPoint, shapeKind, strokeWidth } = annotation;
  const halfStroke = strokeWidth / 2 + tolerance;

  const x1 = Math.min(startPoint.x, endPoint.x);
  const y1 = Math.min(startPoint.y, endPoint.y);
  const x2 = Math.max(startPoint.x, endPoint.x);
  const y2 = Math.max(startPoint.y, endPoint.y);

  switch (shapeKind) {
    case 'line':
      return distanceToSegment(pt, startPoint, endPoint) <= halfStroke;

    case 'arrow':
      return distanceToSegment(pt, startPoint, endPoint) <= halfStroke;

    case 'rectangle':
    case 'roundedRect': {
      const hasFill = annotation.fillColor !== 'transparent';
      if (hasFill) {
        return pt.x >= x1 - tolerance && pt.x <= x2 + tolerance &&
               pt.y >= y1 - tolerance && pt.y <= y2 + tolerance;
      }
      // No fill: only hit on border
      return hitTestRectBorder(pt, x1, y1, x2, y2, halfStroke);
    }

    case 'ellipse': {
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;
      const rx = (x2 - x1) / 2;
      const ry = (y2 - y1) / 2;
      const hasFill = annotation.fillColor !== 'transparent';
      if (hasFill) {
        return pointInEllipse(pt, cx, cy, rx + tolerance, ry + tolerance);
      }
      // Border only
      const inner = pointInEllipse(pt, cx, cy, rx - halfStroke, ry - halfStroke);
      const outer = pointInEllipse(pt, cx, cy, rx + halfStroke, ry + halfStroke);
      return outer && !inner;
    }
  }
}

// ─── Eraser hit test ──────────────────────────────────────────────────────────

/**
 * Eraser hit test: given the eraser center in PDF User Space,
 * return all annotations that intersect the eraser.
 *
 * Uses the same proximity-based approach as selection hit testing,
 * but with a larger eraser radius.
 *
 * @param pdfPoint   - Eraser center in PDF User Space
 * @param annotations - Annotation array for this page
 * @param eraserSizePdf - Eraser radius in PDF points
 */
export function eraserHitTest(
  pdfPoint: PdfPoint,
  annotations: Annotation[],
  eraserSizePdf: number,
): Annotation[] {
  const hit: Annotation[] = [];
  for (const ann of annotations) {
    if (ann.locked) continue;
    if (hitTestAnnotation(pdfPoint, ann, eraserSizePdf)) {
      hit.push(ann);
    }
  }
  return hit;
}

// ─── Bounding box helper for selection box ─────────────────────────────────────

/**
 * Get the axis-aligned bounding rect of an annotation in PDF User Space.
 * Used for selection box intersection and selection handles.
 */
export function getAnnotationBounds(annotation: Annotation): PdfRect {
  switch (annotation.type) {
    case 'stroke':
    case 'highlight': {
      const { minX, minY, maxX, maxY } = pointsBoundingBox(annotation.points);
      const pad = annotation.width / 2;
      return { x: minX - pad, y: minY - pad, width: (maxX - minX) + pad * 2, height: (maxY - minY) + pad * 2 };
    }
    case 'text':
      return annotation.bounds;
    case 'shape': {
      const { startPoint, endPoint, strokeWidth, shapeKind } = annotation;
      let x = Math.min(startPoint.x, endPoint.x);
      let y = Math.min(startPoint.y, endPoint.y);
      let w = Math.abs(endPoint.x - startPoint.x);
      let h = Math.abs(endPoint.y - startPoint.y);
      
      let pad = strokeWidth / 2;
      if (shapeKind === 'arrow') {
        // Arrow heads extend beyond the endpoints
        pad = strokeWidth * 4 + 12; 
      }
      return { x: x - pad, y: y - pad, width: w + pad * 2, height: h + pad * 2 };
    }
  }
}

/**
 * Test if two PdfRects intersect (for rubber-band selection).
 */
export function rectsIntersect(a: PdfRect, b: PdfRect): boolean {
  return !(
    a.x + a.width < b.x ||
    b.x + b.width < a.x ||
    a.y + a.height < b.y ||
    b.y + b.height < a.y
  );
}

// ─── Geometry primitives ──────────────────────────────────────────────────────

/** Distance from point P to line segment AB. */
function distanceToSegment(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    // Degenerate segment
    return Math.hypot(p.x - a.x, p.y - a.y);
  }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const nearX = a.x + t * dx;
  const nearY = a.y + t * dy;
  return Math.hypot(p.x - nearX, p.y - nearY);
}

/** Point in axis-aligned rectangle. */
function pointInRect(pt: { x: number; y: number }, rect: PdfRect): boolean {
  return pt.x >= rect.x && pt.x <= rect.x + rect.width &&
         pt.y >= rect.y && pt.y <= rect.y + rect.height;
}

/** Point in ellipse. */
function pointInEllipse(
  pt: { x: number; y: number },
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): boolean {
  if (rx <= 0 || ry <= 0) return false;
  const dx = (pt.x - cx) / rx;
  const dy = (pt.y - cy) / ry;
  return dx * dx + dy * dy <= 1;
}

/** Hit test rectangle border only (unfilled shapes). */
function hitTestRectBorder(
  pt: { x: number; y: number },
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  halfStroke: number,
): boolean {
  // Inside outer rect
  const inOuter = pt.x >= x1 - halfStroke && pt.x <= x2 + halfStroke &&
                  pt.y >= y1 - halfStroke && pt.y <= y2 + halfStroke;
  // Outside inner rect
  const inInner = pt.x >= x1 + halfStroke && pt.x <= x2 - halfStroke &&
                  pt.y >= y1 + halfStroke && pt.y <= y2 - halfStroke;
  return inOuter && !inInner;
}

// ─── Resize handle helpers ─────────────────────────────────────────────────────

export type ResizeHandleId = 'nw' | 'n' | 'ne' | 'w' | 'e' | 'sw' | 's' | 'se';

export interface ResizeHandle {
  id: ResizeHandleId;
  x: number; // PDF User Space
  y: number;
}

const HANDLE_SIZE_PDF = 6; // PDF points — scaled during rendering

/**
 * Get the resize handle positions for an annotation's bounding rect.
 * Positions are in PDF User Space.
 */
export function getResizeHandles(bounds: PdfRect): ResizeHandle[] {
  const { x, y, width: w, height: h } = bounds;
  const cx = x + w / 2;
  const cy = y + h / 2;
  return [
    { id: 'nw', x, y: y + h },
    { id: 'n',  x: cx, y: y + h },
    { id: 'ne', x: x + w, y: y + h },
    { id: 'w',  x, y: cy },
    { id: 'e',  x: x + w, y: cy },
    { id: 'sw', x, y },
    { id: 's',  x: cx, y },
    { id: 'se', x: x + w, y },
  ];
}

/**
 * Find which resize handle (if any) was clicked.
 * @param pdfPoint - Pointer position in PDF User Space
 * @param handles  - Handle positions from getResizeHandles
 * @param transform - Canonical page transform
 */
export function hitTestResizeHandle(
  pdfPoint: PdfPoint,
  handles: ResizeHandle[],
  transform: PageTransform,
): ResizeHandle | null {
  const tolerance = (HANDLE_SIZE_PDF / 2 + 2) / transform.scale;
  for (const handle of handles) {
    const dx = Math.abs(pdfPoint.x - handle.x);
    const dy = Math.abs(pdfPoint.y - handle.y);
    if (dx <= tolerance && dy <= tolerance) return handle;
  }
  return null;
}

export { HANDLE_SIZE_PDF };
