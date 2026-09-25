import type { Annotation, PdfRect, PdfPoint } from '../types/annotations';
import { pointsBoundingBox } from './coordinateTransform';

/**
 * Get the axis-aligned bounding rect of an annotation in PDF User Space.
 */
export function getAnnotationBounds(annotation: Annotation): PdfRect {
  switch (annotation.type) {
    case 'stroke':
    case 'highlight': {
      const { minX, minY, maxX, maxY } = pointsBoundingBox(annotation.points);
      const pad = annotation.width / 2;
      return { x: minX - pad, y: minY - pad, width: (maxX - minX) + pad * 2, height: (maxY - minY) + pad * 2 };
    }
    case 'freeform': {
      const { minX, minY, maxX, maxY } = pointsBoundingBox(annotation.points);
      const pad = annotation.strokeWidth / 2;
      return { x: minX - pad, y: minY - pad, width: (maxX - minX) + pad * 2, height: (maxY - minY) + pad * 2 };
    }
    case 'text':
      return annotation.bounds;
    case 'shape': {
      const { startPoint, endPoint, strokeWidth, shapeKind } = annotation;
      const x = Math.min(startPoint.x, endPoint.x);
      const y = Math.min(startPoint.y, endPoint.y);
      const w = Math.abs(endPoint.x - startPoint.x);
      const h = Math.abs(endPoint.y - startPoint.y);
      
      let pad = strokeWidth / 2;
      if (shapeKind === 'arrow') {
        // Arrow heads extend beyond the endpoints
        pad = strokeWidth * 4 + 12; 
      }
      return { x: x - pad, y: y - pad, width: w + pad * 2, height: h + pad * 2 };
    }
    case 'image':
      return { x: annotation.x, y: annotation.y, width: annotation.width, height: annotation.height };
  }
}

/**
 * Get the union of bounding rects for a group of annotations in PDF User Space.
 * Handles degenerate (zero-size) bounds safely.
 */
export function getGroupBounds(annotations: Annotation[]): PdfRect | null {
  if (annotations.length === 0) return null;
  
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  
  for (const ann of annotations) {
    const b = getAnnotationBounds(ann);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  
  // Guard against invalid bounds if something was extremely degenerate
  if (minX === Infinity || minY === Infinity || maxX === -Infinity || maxY === -Infinity) {
    return null;
  }
  
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}
