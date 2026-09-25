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

export type ResizeHandleId = 'nw' | 'n' | 'ne' | 'w' | 'e' | 'sw' | 's' | 'se';

/**
 * Target bounds for a resize gesture, in PDF user space (y grows UP).
 *
 * Handle names are visual at 0° (see getResizeHandles): 'n' sits on the top
 * edge (y + height) and 's' on the bottom edge (y). Dragging a handle moves
 * that edge; the opposite edge stays anchored.
 *
 * With `lockAspect` (single image, corner handle, no Shift) the size follows
 * the pointer while keeping the original aspect ratio, anchored at the corner
 * opposite the dragged one.
 */
export function computeResizeTargetBounds(
  original: PdfRect,
  handleId: ResizeHandleId,
  pointer: PdfPoint,
  lockAspect = false,
): PdfRect {
  const left = original.x;
  const right = original.x + original.width;
  const bottom = original.y;
  const top = original.y + original.height;

  let x1 = left;
  let x2 = right;
  let y1 = bottom;
  let y2 = top;

  if (handleId.includes('n')) y2 = pointer.y;
  if (handleId.includes('s')) y1 = pointer.y;
  if (handleId.includes('w')) x1 = pointer.x;
  if (handleId.includes('e')) x2 = pointer.x;

  const isCorner = handleId.length === 2;
  if (lockAspect && isCorner && original.width > 0 && original.height > 0) {
    const aspect = original.width / original.height;
    const rawW = Math.abs(x2 - x1);
    const rawH = Math.abs(y2 - y1);
    const lockedW = Math.max(10, Math.max(rawW, rawH * aspect));
    const lockedH = Math.max(10, lockedW / aspect);

    // Anchor = corner opposite the dragged handle.
    if (handleId.includes('e')) { x1 = left; x2 = left + lockedW; }
    else { x2 = right; x1 = right - lockedW; }
    if (handleId.includes('n')) { y1 = bottom; y2 = bottom + lockedH; }
    else { y2 = top; y1 = top - lockedH; }
  }

  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}
