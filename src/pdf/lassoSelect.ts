/** Lasso (free-form) selection: which annotations lie inside a drawn loop. */
import type { Annotation, PdfPoint } from '../types/annotations';
import { getAnnotationBounds } from './annotationGeometry';

export function pointInPolygon(point: PdfPoint, polygon: readonly PdfPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Share of an annotation's defining points that must be inside the loop. */
export const LASSO_INK_SHARE = 0.5;

export function isInsideLasso(annotation: Annotation, polygon: readonly PdfPoint[]): boolean {
  if (polygon.length < 3) return false;
  if (annotation.type === 'stroke' || annotation.type === 'highlight' || annotation.type === 'freeform') {
    const points = annotation.points;
    if (points.length === 0) return false;
    // Long strokes: a sample is enough (and keeps big selections fast).
    const step = Math.max(1, Math.floor(points.length / 200));
    let inside = 0;
    let total = 0;
    for (let i = 0; i < points.length; i += step) {
      total++;
      if (pointInPolygon(points[i], polygon)) inside++;
    }
    return inside / total >= LASSO_INK_SHARE;
  }
  const bounds = getAnnotationBounds(annotation);
  return pointInPolygon({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }, polygon);
}

/** Ids of the unlocked, visible annotations inside the loop, in z-order. */
export function annotationsInLasso(annotations: readonly Annotation[], polygon: readonly PdfPoint[]): string[] {
  return annotations
    .filter((annotation) => !annotation.hidden && !annotation.locked && isInsideLasso(annotation, polygon))
    .map((annotation) => annotation.id);
}
