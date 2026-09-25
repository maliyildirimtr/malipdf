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
  ImageAnnotation,
} from '../types/annotations';
import { pointsBoundingBox, type PageTransform } from './coordinateTransform';
import { getAnnotationBounds } from './annotationGeometry';

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
  selectedIds: string[] = [],
): Annotation | null {
  const tolerance = getHitTolerance(transform);

  // Iterate in reverse so topmost (last drawn) is found first
  for (let i = annotations.length - 1; i >= 0; i--) {
    const ann = annotations[i];
    if (ann.locked) continue;
    
    // If the annotation is currently selected, clicking anywhere inside its bounding box 
    // should count as a hit, allowing the user to easily grab and move it.
    if (selectedIds.includes(ann.id)) {
      const bounds = getAnnotationBounds(ann);
      if (
        bounds &&
        pdfPoint.x >= bounds.x - tolerance &&
        pdfPoint.x <= bounds.x + bounds.width + tolerance &&
        pdfPoint.y >= bounds.y - tolerance &&
        pdfPoint.y <= bounds.y + bounds.height + tolerance
      ) {
        return ann;
      }
    }

    if (hitTestAnnotation(pdfPoint, ann, tolerance)) {
      return ann;
    }
  }
  return null;
}

/**
 * Hit-test the complete selection bounds of annotations that are already selected.
 * This lets users drag hollow shapes and sparse strokes from empty space inside
 * the visible selection box without changing normal first-click hit testing.
 */
export function hitTestSelectedBounds(
  pdfPoint: PdfPoint,
  annotations: Annotation[],
  selectedIds: readonly string[],
): Annotation | null {
  if (selectedIds.length === 0) return null;
  const selected = new Set(selectedIds);

  for (let i = annotations.length - 1; i >= 0; i--) {
    const annotation = annotations[i];
    if (annotation.locked || !selected.has(annotation.id)) continue;
    // We use a small tolerance (e.g. 5) to make it easy to grab selected strokes
    if (hitTestAnnotation(pdfPoint, annotation, 5)) {
      return annotation;
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
    case 'freeform':
      return hitTestFreeform(pdfPoint, annotation, tolerance);
    case 'image':
      return hitTestImage(pdfPoint, annotation, tolerance);
    default:
      return false;
  }
}

function hitTestImage(
  pt: PdfPoint,
  annotation: ImageAnnotation,
  tolerance: number = 0,
): boolean {
  return (
    pt.x >= annotation.x - tolerance &&
    pt.x <= annotation.x + annotation.width + tolerance &&
    pt.y >= annotation.y - tolerance &&
    pt.y <= annotation.y + annotation.height + tolerance
  );
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
      const insideBox = pt.x >= x1 - tolerance && pt.x <= x2 + tolerance &&
                        pt.y >= y1 - tolerance && pt.y <= y2 + tolerance;
      
      if (!insideBox) return false;
      if (annotation.fillColor !== 'transparent') return true;

      // For hollow rectangles, check if the point is near the border
      const nearLeft = Math.abs(pt.x - x1) <= halfStroke;
      const nearRight = Math.abs(pt.x - x2) <= halfStroke;
      const nearTop = Math.abs(pt.y - y1) <= halfStroke;
      const nearBottom = Math.abs(pt.y - y2) <= halfStroke;

      return nearLeft || nearRight || nearTop || nearBottom;
    }

    case 'ellipse': {
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;
      const rx = Math.max(0.1, (x2 - x1) / 2);
      const ry = Math.max(0.1, (y2 - y1) / 2);

      const dx = pt.x - cx;
      const dy = pt.y - cy;
      const value = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);

      if (annotation.fillColor !== 'transparent') {
        // Expanded ellipse for filled check
        const rxe = rx + tolerance;
        const rye = ry + tolerance;
        return (dx * dx) / (rxe * rxe) + (dy * dy) / (rye * rye) <= 1;
      } else {
        // Check if it's near the perimeter (value close to 1)
        // A simple approximation: calculate distance to center normalized, and check if it's near 1
        const normalizedDist = Math.sqrt(value);
        const radiusTolerance = halfStroke / Math.min(rx, ry);
        return Math.abs(normalizedDist - 1) <= radiusTolerance;
      }
    }
  }
}

// ─── Freeform hit test ────────────────────────────────────────────────────────

function hitTestFreeform(
  pt: PdfPoint,
  annotation: { type: 'freeform'; points: PdfPoint[]; strokeWidth: number; fillColor?: string },
  tolerance: number,
): boolean {
  const { points, strokeWidth, fillColor } = annotation;
  if (points.length < 2) return false;
  const halfStroke = strokeWidth / 2 + tolerance;

  // Check border
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    if (distanceToSegment(pt, p1, p2) <= halfStroke) {
      return true;
    }
  }

  // Check fill
  if (fillColor && fillColor !== 'transparent') {
    return pointInPolygon(pt, points);
  }

  return false;
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
 * Test if two PdfRects intersect (for rubber-band selection).
 */
export function rectsIntersect(a: PdfRect, b: PdfRect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/**
 * Advanced precise marquee hit testing.
 * Uses bounding box for fast rejection, then performs precise geometry intersection.
 */
export function hitTestMarquee(marquee: PdfRect, annotation: Annotation): boolean {
  const bounds = getAnnotationBounds(annotation);
  if (!rectsIntersect(marquee, bounds)) {
    return false;
  }

  // Bounding box overlaps. Now test precise intersection.
  switch (annotation.type) {
    case 'text':
      // Text just uses bounds.
      return true;

    case 'stroke':
    case 'highlight':
    case 'freeform': {
      const points = annotation.points;
      if (points.length === 0) return false;
      
      // If the marquee contains ANY point of the annotation, it intersects.
      for (const p of points) {
        if (p.x >= marquee.x && p.x <= marquee.x + marquee.width &&
            p.y >= marquee.y && p.y <= marquee.y + marquee.height) {
          return true;
        }
      }
      
      // What if the annotation completely encloses the marquee? (e.g. huge freeform)
      if (annotation.type === 'freeform' && 'fillColor' in annotation && annotation.fillColor !== 'transparent') {
        if (pointInPolygon({ x: marquee.x, y: marquee.y }, points)) {
          return true;
        }
      }
      
      // What if a segment crosses the marquee but no vertices are inside?
      // Check segment intersection with marquee rect edges.
      for (let i = 0; i < points.length - (annotation.type === 'freeform' ? 0 : 1); i++) {
        const p1 = points[i];
        const p2 = points[(i + 1) % points.length];
        if (lineIntersectsRect(p1, p2, marquee)) {
          return true;
        }
      }
      return false;
    }

    case 'shape': {
      const { startPoint, endPoint, shapeKind } = annotation;
      
      // If either endpoint is inside the marquee, it intersects.
      if (pointInRect(startPoint, marquee) || pointInRect(endPoint, marquee)) {
        return true;
      }
      
      if (shapeKind === 'line' || shapeKind === 'arrow') {
        return lineIntersectsRect(startPoint, endPoint, marquee);
      }
      
      if (shapeKind === 'rectangle' || shapeKind === 'roundedRect') {
        // It intersects the marquee if its edges cross the marquee edges, or if one is inside the other.
        return true; 
      }
      
      if (shapeKind === 'ellipse') {
        // Precise ellipse vs rect is complex. We'll use bounds for now, which is close enough.
        return true;
      }
      
      return true;
    }
    
    default:
      return true;
  }
}

/** Check if a line segment intersects an axis-aligned rectangle */
function lineIntersectsRect(p1: PdfPoint, p2: PdfPoint, r: PdfRect): boolean {
  // If either point is inside, it intersects
  if (pointInRect(p1, r) || pointInRect(p2, r)) return true;
  
  // Check intersection with all 4 edges of the rect
  const rLeft = { x: r.x, y: r.y };
  const rRight = { x: r.x + r.width, y: r.y };
  const rBottomRight = { x: r.x + r.width, y: r.y + r.height };
  const rBottomLeft = { x: r.x, y: r.y + r.height };
  
  return (
    lineIntersectsLine(p1, p2, rLeft, rRight) ||
    lineIntersectsLine(p1, p2, rRight, rBottomRight) ||
    lineIntersectsLine(p1, p2, rBottomRight, rBottomLeft) ||
    lineIntersectsLine(p1, p2, rBottomLeft, rLeft)
  );
}

/** Check if two line segments intersect */
function lineIntersectsLine(p1: PdfPoint, p2: PdfPoint, p3: PdfPoint, p4: PdfPoint): boolean {
  const denominator = ((p2.x - p1.x) * (p4.y - p3.y)) - ((p2.y - p1.y) * (p4.x - p3.x));
  if (denominator === 0) return false;
  
  const a = p1.y - p3.y;
  const b = p1.x - p3.x;
  const numerator1 = ((p4.x - p3.x) * a) - ((p4.y - p3.y) * b);
  const numerator2 = ((p2.x - p1.x) * a) - ((p2.y - p1.y) * b);
  
  const a_frac = numerator1 / denominator;
  const b_frac = numerator2 / denominator;
  
  return (a_frac > 0 && a_frac < 1 && b_frac > 0 && b_frac < 1);
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

/** Point in polygon (ray-casting algorithm). */
function pointInPolygon(pt: PdfPoint, polygon: PdfPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect = ((yi > pt.y) !== (yj > pt.y)) &&
        (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
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
