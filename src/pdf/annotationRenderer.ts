/**
 * Annotation Renderer
 *
 * Renders annotation objects onto a 2D canvas.
 *
 * All input coordinates are in PDF user space.
 * The renderer transforms them to screen coordinates using
 * the current page proxy and scale.
 *
 * This renderer is called:
 * 1. On the static annotation canvas (completed annotations)
 * 2. On the drawing canvas (in-progress stroke only)
 *
 * Architecture:
 *   Annotations (PDF space) → pdfToScreenPoint → Canvas draw calls
 */

import type {
  Annotation,
  StrokeAnnotation,
  HighlightAnnotation,
  TextAnnotation,
  ShapeAnnotation,
  FreeformAnnotation,
  ImageAnnotation,
  InputPoint,
} from '../types/annotations';
import {
  pdfPointsToScreen,
  pdfToScreen,
  pdfRectToScreenBounds,
  type PageTransform,
} from './coordinateTransform';
import type { DocumentIdentity } from '../types/documentSession';
import { getCachedDecodedImage, requestImageDecode } from './imageRenderCache';
import { useAssetStore } from '../store/assetStore';


// ─── Smoothing helper ─────────────────────────────────────────────────────────

/**
 * Apply Catmull-Rom spline smoothing to a sequence of points.
 * Returns a new array with interpolated points.
 */
function catmullRomPoints(points: InputPoint[], tension: number = 0.5): InputPoint[] {
  if (points.length < 3) return points;

  const result: InputPoint[] = [points[0]];

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(i + 2, points.length - 1)];

    // Generate intermediate points
    const steps = 8;
    for (let t = 1; t <= steps; t++) {
      const s = t / steps;
      const s2 = s * s;
      const s3 = s2 * s;

      const x =
        0.5 * (
          (2 * p1.x) +
          (-p0.x + p2.x) * s +
          (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * s2 +
          (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * s3
        );

      const y =
        0.5 * (
          (2 * p1.y) +
          (-p0.y + p2.y) * s +
          (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * s2 +
          (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * s3
        );

      // Interpolate pressure
      const pressure = p1.pressure + (p2.pressure - p1.pressure) * s;

      result.push({ x, y, pressure, timestamp: p1.timestamp });
    }
  }

  result.push(points[points.length - 1]);
  return result;
}

// ─── Main render functions ────────────────────────────────────────────────────

export function renderAnnotations(
  ctx: CanvasRenderingContext2D,
  annotations: Annotation[],
  transform: PageTransform,
  dpr: number = 1,
  identity?: DocumentIdentity,
  onImageDecoded?: () => void,
): void {
  ctx.save();
  ctx.scale(dpr, dpr);

  for (const ann of annotations) {
    switch (ann.type) {
      case 'stroke':
        renderStroke(ctx, ann, transform);
        break;
      case 'highlight':
        renderHighlight(ctx, ann, transform);
        break;
      case 'text':
        renderText(ctx, ann, transform);
        break;
      case 'shape':
        renderShape(ctx, ann, transform);
        break;
      case 'freeform':
        renderFreeform(ctx, ann, transform);
        break;
      case 'image':
        renderImage(ctx, ann, transform, identity, onImageDecoded);
        break;
      default:
        console.warn(`Unsupported annotation type: ${(ann as any).type}`);
    }
  }

  ctx.restore();
}

// ─── Image ────────────────────────────────────────────────────────────────────

export function renderImage(
  ctx: CanvasRenderingContext2D,
  annotation: ImageAnnotation,
  transform: PageTransform,
  identity?: DocumentIdentity,
  onImageDecoded?: () => void,
): void {
  const screenRect = pdfRectToScreenBounds(
    { x: annotation.x, y: annotation.y, width: annotation.width, height: annotation.height },
    transform,
  );

  if (!identity) {
    ctx.save();
    ctx.strokeStyle = '#888888';
    ctx.lineWidth = 1;
    ctx.strokeRect(screenRect.x, screenRect.y, screenRect.width, screenRect.height);
    ctx.restore();
    return;
  }

  const cachedImage = getCachedDecodedImage(identity, annotation.assetId);

  if (cachedImage) {
    ctx.save();
    if (typeof annotation.opacity === 'number' && annotation.opacity < 1) {
      ctx.globalAlpha = Math.max(0, Math.min(1, annotation.opacity));
    }
    ctx.drawImage(
      cachedImage,
      screenRect.x,
      screenRect.y,
      screenRect.width,
      screenRect.height,
    );
    ctx.restore();
    return;
  }

  // Not yet decoded: request decode
  const asset = useAssetStore.getState().getAsset(identity, annotation.assetId);
  if (asset) {
    requestImageDecode(identity, asset, onImageDecoded);
  }

  // Draw subtle placeholder rect while decoding
  ctx.save();
  ctx.strokeStyle = '#cccccc';
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  ctx.strokeRect(screenRect.x, screenRect.y, screenRect.width, screenRect.height);
  ctx.restore();
}

// ─── Stroke ───────────────────────────────────────────────────────────────────

export function renderStroke(
  ctx: CanvasRenderingContext2D,
  annotation: StrokeAnnotation,
  transform: PageTransform,
): void {
  if (annotation.points.length < 2) return;

  // Convert PDF space → screen space
  const screenPoints = pdfPointsToScreen(annotation.points, transform);

  // Apply smoothing
  const pts = annotation.smooth ? catmullRomPoints(screenPoints) : screenPoints;

  ctx.globalAlpha = annotation.opacity;
  ctx.strokeStyle = annotation.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (annotation.pressure && pts.some((p) => p.pressure !== 0.5)) {
    // Variable-width stroke using pressure
    renderVariableWidthStroke(ctx, pts, annotation.width * transform.scale);
  } else {
    // Uniform width stroke
    ctx.lineWidth = annotation.width * transform.scale;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.stroke();
  }
}

function renderVariableWidthStroke(
  ctx: CanvasRenderingContext2D,
  pts: InputPoint[],
  baseWidth: number,
): void {
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 1];
    const p1 = pts[i];
    const width = baseWidth * (0.3 + p0.pressure * 1.4);

    ctx.beginPath();
    ctx.lineWidth = width;
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
  }
}

// ─── Highlight ────────────────────────────────────────────────────────────────

export function renderHighlight(
  ctx: CanvasRenderingContext2D,
  annotation: HighlightAnnotation,
  transform: PageTransform,
): void {
  if (annotation.points.length < 2) return;

  const screenPoints = pdfPointsToScreen(annotation.points, transform);
  const pts = catmullRomPoints(screenPoints, 0.3);

  ctx.globalAlpha = annotation.opacity;
  ctx.globalCompositeOperation = 'multiply';
  ctx.strokeStyle = annotation.color;
  ctx.lineWidth = annotation.width * transform.scale;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i].x, pts[i].y);
  }
  ctx.stroke();

  // Reset composite operation
  ctx.globalCompositeOperation = 'source-over';
}

// ─── Text ─────────────────────────────────────────────────────────────────────

export function renderText(
  ctx: CanvasRenderingContext2D,
  annotation: TextAnnotation,
  transform: PageTransform,
): void {
  const { bounds } = annotation;
  const topLeft = pdfToScreen(bounds.x, bounds.y + bounds.height, transform);
  const pdfXAxis = pdfToScreen(bounds.x + 1, bounds.y + bounds.height, transform);
  const pdfDownAxis = pdfToScreen(bounds.x, bounds.y + bounds.height - 1, transform);
  const xAxis = { x: pdfXAxis.x - topLeft.x, y: pdfXAxis.y - topLeft.y };
  const downAxis = { x: pdfDownAxis.x - topLeft.x, y: pdfDownAxis.y - topLeft.y };

  ctx.save();
  // Local coordinates are PDF points with an origin at the visual top-left.
  // +X follows PDF +X; local +Y follows PDF -Y, keeping glyphs unmirrored.
  ctx.transform(xAxis.x, xAxis.y, downAxis.x, downAxis.y, topLeft.x, topLeft.y);
  ctx.globalAlpha = annotation.opacity;

  // Background
  if (annotation.backgroundColor !== 'transparent') {
    ctx.fillStyle = annotation.backgroundColor;
    ctx.fillRect(0, 0, bounds.width, bounds.height);
  }

  // Text
  const fontStyle = [
    annotation.italic ? 'italic' : '',
    annotation.bold ? 'bold' : '',
    `${annotation.fontSize}px`,
    annotation.fontFamily,
  ]
    .filter(Boolean)
    .join(' ');

  ctx.font = fontStyle;
  ctx.fillStyle = annotation.color;
  ctx.textBaseline = 'top';

  // Word wrap
  const words = annotation.content.split('\n');
  let lineY = 4;

  for (const line of words) {
    const textLines = wrapText(ctx, line, bounds.width - 8);
    for (const textLine of textLines) {
      let textX = 4;
      if (annotation.align === 'center') {
        textX = (bounds.width - ctx.measureText(textLine).width) / 2;
      } else if (annotation.align === 'right') {
        textX = bounds.width - ctx.measureText(textLine).width - 4;
      }
      ctx.fillText(textLine, textX, lineY);

      if (annotation.underline) {
        const textWidth = ctx.measureText(textLine).width;
        ctx.beginPath();
        ctx.moveTo(textX, lineY + annotation.fontSize + 1);
        ctx.lineTo(textX + textWidth, lineY + annotation.fontSize + 1);
        ctx.strokeStyle = annotation.color;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      lineY += annotation.fontSize * 1.4;
    }
  }
  ctx.restore();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

// ─── Shape ────────────────────────────────────────────────────────────────────

export function renderShape(
  ctx: CanvasRenderingContext2D,
  annotation: ShapeAnnotation,
  transform: PageTransform,
): void {
  const start = pdfToScreen(annotation.startPoint.x, annotation.startPoint.y, transform);
  const end = pdfToScreen(annotation.endPoint.x, annotation.endPoint.y, transform);

  ctx.lineWidth = annotation.strokeWidth * transform.scale;
  ctx.strokeStyle = annotation.color;
  ctx.fillStyle = annotation.fillColor;
  ctx.globalAlpha = annotation.opacity;
  ctx.lineCap = annotation.shapeKind === 'arrow' || annotation.shapeKind === 'line' ? 'round' : 'square';
  ctx.lineJoin = 'round';

  if (annotation.borderStyle && annotation.borderStyle !== 'solid') {
    const sw = annotation.strokeWidth * transform.scale;
    switch (annotation.borderStyle) {
      case 'dashed': ctx.setLineDash([sw * 4, sw * 3]); break;
      case 'dotted': ctx.setLineDash([sw, sw * 2]); break;
      case 'dash-dot': ctx.setLineDash([sw * 4, sw * 3, sw, sw * 3]); break;
      case 'dash-dot-dot': ctx.setLineDash([sw * 4, sw * 3, sw, sw * 3, sw, sw * 3]); break;
    }
  } else {
    ctx.setLineDash([]);
  }

  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const w = Math.abs(end.x - start.x);
  const h = Math.abs(end.y - start.y);

  ctx.beginPath();

  switch (annotation.shapeKind) {
    case 'line':
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      break;

    case 'arrow':
      drawArrow(ctx, start.x, start.y, end.x, end.y, annotation.strokeWidth * transform.scale);
      break;

    case 'rectangle':
      ctx.rect(x, y, w, h);
      if (annotation.fillColor !== 'transparent') ctx.fill();
      ctx.stroke();
      break;

    case 'roundedRect': {
      const r = Math.min(
        (annotation.cornerRadius ?? 8) * transform.scale,
        Math.min(w, h) / 2,
      );
      ctx.roundRect(x, y, w, h, r);
      if (annotation.fillColor !== 'transparent') ctx.fill();
      ctx.stroke();
      break;
    }

    case 'ellipse':
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      if (annotation.fillColor !== 'transparent') ctx.fill();
      ctx.stroke();
      break;
  }
}

// ─── Freeform ─────────────────────────────────────────────────────────────────

export function renderFreeform(
  ctx: CanvasRenderingContext2D,
  annotation: FreeformAnnotation,
  transform: PageTransform,
): void {
  if (annotation.points.length < 2) return;
  const screenPoints = annotation.points.map(p => {
    const { x, y } = pdfToScreen(p.x, p.y, transform);
    return { ...p, x, y };
  });
  ctx.lineWidth = annotation.strokeWidth * transform.scale;
  ctx.strokeStyle = annotation.color;
  ctx.fillStyle = annotation.fillColor;
  ctx.globalAlpha = annotation.opacity;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  ctx.moveTo(screenPoints[0].x, screenPoints[0].y);
  for (let i = 1; i < screenPoints.length; i++) {
    ctx.lineTo(screenPoints[i].x, screenPoints[i].y);
  }
  
  if (annotation.id !== 'temp' || annotation.fillColor !== 'transparent') {
    ctx.closePath();
  }
  
  if (annotation.fillColor !== 'transparent') {
    ctx.fill();
  }
  ctx.stroke();
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  lineWidth: number,
): void {
  const angle = Math.atan2(toY - fromY, toX - fromX);
  const headLength = Math.max(12, lineWidth * 4);

  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();

  // Arrowhead should always be solid
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(
    toX - headLength * Math.cos(angle - Math.PI / 6),
    toY - headLength * Math.sin(angle - Math.PI / 6),
  );
  ctx.moveTo(toX, toY);
  ctx.lineTo(
    toX - headLength * Math.cos(angle + Math.PI / 6),
    toY - headLength * Math.sin(angle + Math.PI / 6),
  );
  ctx.stroke();
}

// ─── In-progress stroke renderer ─────────────────────────────────────────────

/**
 * Render an in-progress stroke on the drawing canvas.
 * Points are already in screen space (raw from pointer events).
 *
 * This is called at pointer event frequency and must be fast.
 * It does NOT go through pdf.js viewport transform — input is already screen coords.
 */
export function renderActiveStroke(
  ctx: CanvasRenderingContext2D,
  points: InputPoint[],
  color: string,
  width: number,
  opacity: number,
  isHighlight: boolean,
  dpr: number,
): void {
  if (points.length < 2) return;

  ctx.save();
  ctx.scale(dpr, dpr);

  ctx.globalAlpha = opacity;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (isHighlight) {
    ctx.globalCompositeOperation = 'multiply';
    ctx.lineWidth = width;

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  } else {
    // Pressure-sensitive or uniform
    const hasPressure = points.some((p) => p.pressure !== 0.5);
    if (hasPressure) {
      for (let i = 1; i < points.length; i++) {
        const p = points[i - 1];
        ctx.lineWidth = width * (0.3 + p.pressure * 1.4);
        ctx.beginPath();
        ctx.moveTo(points[i - 1].x, points[i - 1].y);
        ctx.lineTo(points[i].x, points[i].y);
        ctx.stroke();
      }
    } else {
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.stroke();
    }
  }

  ctx.restore();
}

// ─── Shape live preview renderer ──────────────────────────────────────────────

/**
 * Render a shape while the user is still dragging (preview layer).
 * Points are in SCREEN space (no PDF transform needed).
 */
export function renderShapePreview(
  ctx: CanvasRenderingContext2D,
  shapeKind: string,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  color: string,
  strokeWidth: number,
  fillColor: string,
  opacity: number,
  dpr: number,
  borderStyle?: 'solid' | 'dashed' | 'dotted' | 'dash-dot' | 'dash-dot-dot',
): void {
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.strokeStyle = color;
  ctx.fillStyle = fillColor;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = shapeKind === 'arrow' || shapeKind === 'line' ? 'round' : 'square';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = opacity;

  if (borderStyle && borderStyle !== 'solid') {
    switch (borderStyle) {
      case 'dashed': ctx.setLineDash([strokeWidth * 4, strokeWidth * 3]); break;
      case 'dotted': ctx.setLineDash([strokeWidth, strokeWidth * 2]); break;
      case 'dash-dot': ctx.setLineDash([strokeWidth * 4, strokeWidth * 3, strokeWidth, strokeWidth * 3]); break;
      case 'dash-dot-dot': ctx.setLineDash([strokeWidth * 4, strokeWidth * 3, strokeWidth, strokeWidth * 3, strokeWidth, strokeWidth * 3]); break;
    }
  } else {
    ctx.setLineDash([]);
  }

  ctx.beginPath();

  const x = Math.min(startX, endX);
  const y = Math.min(startY, endY);
  const w = Math.abs(endX - startX);
  const h = Math.abs(endY - startY);

  if (fillColor !== 'transparent') {
    ctx.fillStyle = fillColor;
  }

  ctx.beginPath();
  switch (shapeKind) {
    case 'line':
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.stroke();
      break;
    case 'arrow':
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.stroke();
      // Arrowhead should be solid
      ctx.setLineDash([]);
      const angle = Math.atan2(endY - startY, endX - startX);
      const headLen = Math.max(12, strokeWidth * 4);
      ctx.beginPath();
      ctx.moveTo(endX, endY);
      ctx.lineTo(endX - headLen * Math.cos(angle - Math.PI / 6), endY - headLen * Math.sin(angle - Math.PI / 6));
      ctx.moveTo(endX, endY);
      ctx.lineTo(endX - headLen * Math.cos(angle + Math.PI / 6), endY - headLen * Math.sin(angle + Math.PI / 6));
      ctx.stroke();
      break;
    case 'rectangle':
      ctx.rect(x, y, w, h);
      if (fillColor !== 'transparent') ctx.fill();
      ctx.stroke();
      break;
    case 'roundedRect': {
      const r = Math.min(8, Math.min(w, h) / 2);
      ctx.roundRect(x, y, w, h, r);
      if (fillColor !== 'transparent') ctx.fill();
      ctx.stroke();
      break;
    }
    case 'ellipse':
      if (w > 0 && h > 0) {
        ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        if (fillColor !== 'transparent') ctx.fill();
        ctx.stroke();
      }
      break;
  }

  ctx.restore();
}

// ─── Selection overlay renderer ───────────────────────────────────────────────

/**
 * Render selection bounding box and resize handles for selected annotations.
 * All coordinates are in SCREEN space (already transformed from PDF).
 */
export function renderSelectionOverlay(
  ctx: CanvasRenderingContext2D,
  screenBounds: { x: number; y: number; width: number; height: number },
  handles: { x: number; y: number }[],
  dpr: number,
): void {
  ctx.save();
  ctx.scale(dpr, dpr);

  const { x, y, width: w, height: h } = screenBounds;

  // Selection rect
  ctx.strokeStyle = 'rgba(59, 130, 246, 0.9)';
  ctx.fillStyle = 'rgba(59, 130, 246, 0.06)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 3]);
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);

  // Resize handles
  const hs = 7; // handle size in CSS pixels
  for (const handle of handles) {
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.rect(handle.x - hs / 2, handle.y - hs / 2, hs, hs);
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}

// ─── Rubber-band selection renderer ──────────────────────────────────────────

/**
 * Render a rubber-band selection rectangle while the user is dragging.
 * Coordinates in screen space.
 */
export function renderSelectionRect(
  ctx: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  dpr: number,
): void {
  ctx.save();
  ctx.scale(dpr, dpr);

  const x = Math.min(startX, endX);
  const y = Math.min(startY, endY);
  const w = Math.abs(endX - startX);
  const h = Math.abs(endY - startY);

  ctx.strokeStyle = 'rgba(59, 130, 246, 0.8)';
  ctx.fillStyle = 'rgba(59, 130, 246, 0.05)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.restore();
}
