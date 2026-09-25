import type { Annotation, PdfRect, PdfPoint } from '../types/annotations';

export function translateAnnotation(annotation: Annotation, dx: number, dy: number): Annotation {
  if (dx === 0 && dy === 0) return annotation;
  
  switch (annotation.type) {
    case 'stroke':
    case 'highlight':
    case 'freeform': {
      return {
        ...annotation,
        points: annotation.points.map(p => ({ ...p, x: p.x + dx, y: p.y + dy })) as any,
      };
    }
    case 'shape': {
      return {
        ...annotation,
        startPoint: { x: annotation.startPoint.x + dx, y: annotation.startPoint.y + dy },
        endPoint: { x: annotation.endPoint.x + dx, y: annotation.endPoint.y + dy },
      };
    }
    case 'text': {
      return {
        ...annotation,
        bounds: {
          ...annotation.bounds,
          x: annotation.bounds.x + dx,
          y: annotation.bounds.y + dy,
        },
      };
    }
    case 'image': {
      return {
        ...annotation,
        x: annotation.x + dx,
        y: annotation.y + dy,
      };
    }
  }
}

export function scaleAnnotationFromBounds(
  annotation: Annotation,
  originalGroupBounds: PdfRect,
  targetGroupBounds: PdfRect
): Annotation {
  // If group bounds are degenerate, don't scale
  if (originalGroupBounds.width === 0 || originalGroupBounds.height === 0) {
    return annotation;
  }
  
  const scaleX = targetGroupBounds.width / originalGroupBounds.width;
  const scaleY = targetGroupBounds.height / originalGroupBounds.height;
  
  // Translation needed to map original bounds top-left to target bounds top-left
  const translateX = targetGroupBounds.x - (originalGroupBounds.x * scaleX);
  const translateY = targetGroupBounds.y - (originalGroupBounds.y * scaleY);
  
  const transformPoint = <T extends PdfPoint>(p: T): T => ({
    ...p,
    x: p.x * scaleX + translateX,
    y: p.y * scaleY + translateY,
  });

  switch (annotation.type) {
    case 'stroke':
    case 'highlight':
    case 'freeform': {
      return {
        ...annotation,
        points: annotation.points.map(transformPoint) as any,
      };
    }
    case 'shape': {
      return {
        ...annotation,
        startPoint: transformPoint(annotation.startPoint),
        endPoint: transformPoint(annotation.endPoint),
      };
    }
    case 'text': {
      return annotation; 
    }
    case 'image': {
      const newX = annotation.x * scaleX + translateX;
      const newY = annotation.y * scaleY + translateY;
      const newWidth = Math.max(1, annotation.width * scaleX);
      const newHeight = Math.max(1, annotation.height * scaleY);
      return {
        ...annotation,
        x: newX,
        y: newY,
        width: newWidth,
        height: newHeight,
      };
    }
  }
}
