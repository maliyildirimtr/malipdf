import type { PdfPoint, Annotation, StrokeAnnotation, HighlightAnnotation, InputPoint } from '../types/annotations';

// ─── Geometry Primitives ──────────────────────────────────────────────────────

/**
 * Calculates the shortest distance between a point P and a segment AB.
 */
function distancePointToSegment(
  p: PdfPoint,
  a: PdfPoint,
  b: PdfPoint,
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    return Math.hypot(p.x - a.x, p.y - a.y);
  }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Calculates the shortest distance between two line segments AB and CD.
 */
function distanceSegmentToSegment(
  a: PdfPoint,
  b: PdfPoint,
  c: PdfPoint,
  d: PdfPoint,
): number {
  const u = { x: b.x - a.x, y: b.y - a.y };
  const v = { x: d.x - c.x, y: d.y - c.y };
  const w = { x: a.x - c.x, y: a.y - c.y };

  const aSq = u.x * u.x + u.y * u.y; // |u|^2
  const bDot = u.x * v.x + u.y * v.y; // u.v
  const cSq = v.x * v.x + v.y * v.y; // |v|^2
  const dDot = u.x * w.x + u.y * w.y; // u.w
  const eDot = v.x * w.x + v.y * w.y; // v.w

  const D = aSq * cSq - bDot * bDot; // always >= 0
  let sc, sN, sD = D;
  let tc, tN, tD = D;

  // compute the line parameters of the two closest points
  if (D < 1e-8) {
    // The lines are almost parallel
    sN = 0.0;
    sD = 1.0;
    tN = eDot;
    tD = cSq;
  } else {
    // get the closest points on the infinite lines
    sN = (bDot * eDot - cSq * dDot);
    tN = (aSq * eDot - bDot * dDot);
    if (sN < 0.0) {
      sN = 0.0;
      tN = eDot;
      tD = cSq;
    } else if (sN > sD) {
      sN = sD;
      tN = eDot + bDot;
      tD = cSq;
    }
  }

  if (tN < 0.0) {
    tN = 0.0;
    if (-dDot < 0.0) sN = 0.0;
    else if (-dDot > aSq) sN = sD;
    else {
      sN = -dDot;
      sD = aSq;
    }
  } else if (tN > tD) {
    tN = tD;
    if ((-dDot + bDot) < 0.0) sN = 0;
    else if ((-dDot + bDot) > aSq) sN = sD;
    else {
      sN = (-dDot + bDot);
      sD = aSq;
    }
  }

  sc = (Math.abs(sN) < 1e-8 ? 0.0 : sN / sD);
  tc = (Math.abs(tN) < 1e-8 ? 0.0 : tN / tD);

  const dP = {
    x: w.x + (sc * u.x) - (tc * v.x),
    y: w.y + (sc * u.y) - (tc * v.y)
  };

  return Math.hypot(dP.x, dP.y);
}

// ─── Eraser Hit Testing ───────────────────────────────────────────────────────

/**
 * Swept path capsule intersection test.
 * Returns true if segment A (stroke) intersects segment B (eraser swept path)
 * with the combined radius tolerance.
 */
export function sweptPathIntersectsSegment(
  strokeStart: PdfPoint,
  strokeEnd: PdfPoint,
  eraserStart: PdfPoint,
  eraserEnd: PdfPoint,
  combinedRadius: number,
): boolean {
  const dist = distanceSegmentToSegment(strokeStart, strokeEnd, eraserStart, eraserEnd);
  return dist <= combinedRadius;
}

/**
 * Checks if a single point intersects the swept path of the eraser.
 * Used for 1-point annotations or bounds checking.
 */
export function sweptPathIntersectsPoint(
  point: PdfPoint,
  eraserStart: PdfPoint,
  eraserEnd: PdfPoint,
  combinedRadius: number,
): boolean {
  return distancePointToSegment(point, eraserStart, eraserEnd) <= combinedRadius;
}

// ─── Stroke Splitting ─────────────────────────────────────────────────────────

const MIN_SEGMENT_POINTS = 2;

function resampleStrokePath(points: InputPoint[], maxDist: number = 2.0): InputPoint[] {
  if (points.length < 2) return points;
  const result: InputPoint[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const p1 = points[i-1];
    const p2 = points[i];
    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    if (dist > maxDist) {
      const steps = Math.ceil(dist / maxDist);
      for (let j = 1; j < steps; j++) {
        const t = j / steps;
        result.push({
          x: p1.x + (p2.x - p1.x) * t,
          y: p1.y + (p2.y - p1.y) * t,
          pressure: p1.pressure !== undefined && p2.pressure !== undefined ? p1.pressure + (p2.pressure - p1.pressure) * t : p1.pressure,
          timestamp: p1.timestamp !== undefined && p2.timestamp !== undefined ? p1.timestamp + (p2.timestamp - p1.timestamp) * t : p1.timestamp
        });
      }
    }
    result.push(p2);
  }
  return result;
}

/**
 * Splits a continuous array of points into multiple remaining segments
 * after erasing with a swept path.
 * 
 * @param points The original points of the stroke.
 * @param strokeWidth The width of the stroke (used for collision tolerance).
 * @param eraserStart The start point of the eraser swept path in PDF space.
 * @param eraserEnd The end point of the eraser swept path in PDF space.
 * @param eraserRadius The radius of the eraser in PDF space.
 * @returns An array of new point arrays representing the remaining segments.
 */
export function splitStrokePath(
  originalPoints: InputPoint[],
  strokeWidth: number,
  eraserStart: PdfPoint,
  eraserEnd: PdfPoint,
  eraserRadius: number,
): InputPoint[][] {
  if (originalPoints.length === 0) return [];
  
  const points = resampleStrokePath(originalPoints, 1.0);

  const combinedRadius = eraserRadius + (strokeWidth / 2);
  const segments: InputPoint[][] = [];
  let currentSegment: InputPoint[] = [];
  
  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    
    // Check if point itself is erased
    const isPointErased = sweptPathIntersectsPoint(pt, eraserStart, eraserEnd, combinedRadius);
    
    // Also check if the line segment connecting to previous point is erased
    let isSegmentErased = false;
    if (i > 0 && !isPointErased && currentSegment.length > 0) {
      const prevPt = currentSegment[currentSegment.length - 1];
      isSegmentErased = sweptPathIntersectsSegment(prevPt, pt, eraserStart, eraserEnd, combinedRadius);
    }
    
    if (isPointErased) {
      // End current segment if it has enough points
      if (currentSegment.length >= MIN_SEGMENT_POINTS) {
        segments.push([...currentSegment]);
      }
      currentSegment = []; // Reset for the next unbroken part
    } else {
      if (isSegmentErased) {
        if (currentSegment.length >= MIN_SEGMENT_POINTS) {
          segments.push([...currentSegment]);
        }
        currentSegment = [pt];
      } else {
        currentSegment.push(pt);
      }
    }
  }
  
  if (currentSegment.length >= MIN_SEGMENT_POINTS) {
    segments.push(currentSegment);
  }
  
  // Filter out microscopic fragments
  const MIN_SEGMENT_LENGTH = 1.0; // 1 PDF point length threshold
  return segments.filter(seg => {
    let totalLength = 0;
    for (let i = 1; i < seg.length; i++) {
      totalLength += Math.hypot(seg[i].x - seg[i-1].x, seg[i].y - seg[i-1].y);
    }
    return totalLength >= MIN_SEGMENT_LENGTH;
  });
}

export function generateId(): string {
  return crypto.randomUUID();
}

export interface StrokeEraseResult {
  /** True only when the eraser actually touched this stroke. */
  readonly erased: boolean;
  /** Remaining pieces. When `erased` is false this is the untouched input. */
  readonly segments: InputPoint[][];
}

/**
 * Erase-aware wrapper around splitStrokePath.
 *
 * splitStrokePath always resamples its input, so its output can never be
 * compared with the input to decide whether anything was erased. This first
 * runs an exact swept-capsule test on the original polyline and returns the
 * original points unchanged when the eraser did not touch the stroke.
 */
export function eraseStrokePath(
  points: InputPoint[],
  strokeWidth: number,
  eraserStart: PdfPoint,
  eraserEnd: PdfPoint,
  eraserRadius: number,
): StrokeEraseResult {
  if (points.length === 0) return { erased: false, segments: [] };
  const combinedRadius = eraserRadius + strokeWidth / 2;

  let touched = false;
  if (points.length === 1) {
    touched = sweptPathIntersectsPoint(points[0], eraserStart, eraserEnd, combinedRadius);
  } else {
    for (let i = 1; i < points.length; i++) {
      if (sweptPathIntersectsSegment(points[i - 1], points[i], eraserStart, eraserEnd, combinedRadius)) {
        touched = true;
        break;
      }
    }
  }

  if (!touched) return { erased: false, segments: [points] };
  return {
    erased: true,
    segments: splitStrokePath(points, strokeWidth, eraserStart, eraserEnd, eraserRadius),
  };
}
