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
  TextMarkupAnnotation,
  NoteAnnotation,
  MeasureAnnotation,
  TextEditAnnotation,
} from '../types/annotations';
import { coverQuad, coverWidth } from './textEdit';
import { labelAnchor, measureLabel, measureTicks, MEASURE_FONT } from './measure';
import { NOTE_ICON_SIZE } from '../types/annotations';
import { NOTE_ICON_PATHS, NOTE_ICON_STROKE, noteShade } from './noteIcon';
import { markupShape } from './textSelection';
import {
  pdfPointsToScreen,
  pdfToScreen,
  pdfRectToScreenBounds,
  type PageTransform,
} from './coordinateTransform';
import type { DocumentIdentity } from '../types/documentSession';
import { getCachedDecodedImage, requestImageDecode } from './imageRenderCache';
import { cssFont, layoutTextLines, matchPdfText, LINE_HEIGHT, TEXT_PADDING } from './textLayout';
import { useAssetStore } from '../store/assetStore';
import { commandsToPath2D, highlightShape, penShape, type InkShape } from './inkGeometry';
import { mapShape, penStyleOpacity, styledPenShape } from './penStyles';


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
    // Every annotation starts from a clean state: a dashed shape must never
    // leave its dash pattern (or alpha, caps, …) on the next pen stroke.
    ctx.save();
    ctx.setLineDash([]);
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
      case 'markup':
        renderMarkup(ctx, ann, transform);
        break;
      case 'note':
        renderNote(ctx, ann, transform);
        break;
      case 'measure':
        renderMeasure(ctx, ann, transform);
        break;
      case 'textEdit':
        renderTextEdit(ctx, ann, transform);
        break;
      default:
        console.warn(`Unsupported annotation type: ${(ann as any).type}`);
    }
    ctx.restore();
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

// ─── Ink (pen / highlighter) ─────────────────────────────────────────────────
//
// Geometry comes from inkGeometry.ts (shared with the exporter) and is cached
// as a Path2D per annotation object and page transform. Annotation objects are
// immutable in the store, so a redraw of an unchanged page only replays paths.

interface CachedInk {
  transform: PageTransform;
  mode: InkShape['mode'];
  path: Path2D;
}

const inkCache = new WeakMap<Annotation, CachedInk>();

function inkPath(annotation: StrokeAnnotation | HighlightAnnotation, transform: PageTransform): CachedInk {
  const cached = inkCache.get(annotation);
  if (cached && cached.transform === transform) return cached;
  const styled = annotation.type === 'stroke' && annotation.penStyle && annotation.penStyle !== 'ballpoint';
  const screenPoints = styled ? [] : pdfPointsToScreen(annotation.points, transform);
  const shape = annotation.type === 'stroke'
    ? (styled
      // Nib styles are shaped in PDF space (as in the saved file), then mapped.
      ? mapShape(styledPenShape(annotation.points, annotation.width, annotation.smooth, annotation.pressure, annotation.penStyle), (x, y) => pdfToScreen(x, y, transform))
      : penShape(screenPoints, annotation.width * transform.scale, annotation.smooth, annotation.pressure))
    : highlightShape(screenPoints);
  const entry = { transform, mode: shape.mode, path: commandsToPath2D(shape.commands) };
  inkCache.set(annotation, entry);
  return entry;
}

export function renderStroke(
  ctx: CanvasRenderingContext2D,
  annotation: StrokeAnnotation,
  transform: PageTransform,
): void {
  if (annotation.points.length === 0) return;
  const { mode, path } = inkPath(annotation, transform);
  ctx.save();
  ctx.globalAlpha = annotation.opacity * penStyleOpacity(annotation.penStyle);
  if (mode === 'fill') {
    ctx.fillStyle = annotation.color;
    ctx.fill(path);
  } else {
    ctx.strokeStyle = annotation.color;
    ctx.lineWidth = annotation.width * transform.scale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(path);
  }
  ctx.restore();
}

/**
 * Highlights use "multiply" among themselves. On screen they are drawn on
 * their own canvas layer with CSS mix-blend-mode: multiply, so text below stays
 * dark — the same result as the Multiply blend mode in the saved PDF.
 */
export function renderHighlight(
  ctx: CanvasRenderingContext2D,
  annotation: HighlightAnnotation,
  transform: PageTransform,
): void {
  if (annotation.points.length < 2) return;
  const { path } = inkPath(annotation, transform);
  ctx.save();
  ctx.globalAlpha = annotation.opacity;
  ctx.globalCompositeOperation = 'multiply';
  ctx.strokeStyle = annotation.color;
  ctx.lineWidth = annotation.width * transform.scale;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'round';
  ctx.stroke(path);
  ctx.restore();
}

/** Drawn on the multiply (highlight) layer, under the ink. */
export function isMultiplyAnnotation(annotation: Annotation): boolean {
  return annotation.type === 'highlight' || (annotation.type === 'markup' && annotation.markup === 'highlight');
}

// ─── Text markup ──────────────────────────────────────────────────────────────

export function renderMarkup(
  ctx: CanvasRenderingContext2D,
  annotation: TextMarkupAnnotation,
  transform: PageTransform,
): void {
  const { shape, width } = markupShape(annotation.markup, annotation.quads);
  if (shape.commands.length === 0) return;
  const path = new Path2D();
  for (const c of shape.commands) {
    if (c.op === 'Z') { path.closePath(); continue; }
    if (c.op === 'C') continue;
    const p = pdfToScreen(c.x, c.y, transform);
    if (c.op === 'M') path.moveTo(p.x, p.y);
    else path.lineTo(p.x, p.y);
  }
  ctx.save();
  ctx.globalAlpha = annotation.opacity;
  if (shape.mode === 'fill') {
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = annotation.color;
    ctx.fill(path);
  } else {
    ctx.strokeStyle = annotation.color;
    ctx.lineWidth = width * transform.scale;
    ctx.lineCap = 'butt';
    ctx.stroke(path);
  }
  ctx.restore();
}

// ─── Edited PDF text ─────────────────────────────────────────────────────────

export function renderTextEdit(
  ctx: CanvasRenderingContext2D,
  annotation: TextEditAnnotation,
  transform: PageTransform,
): void {
  const quad = coverQuad(annotation, coverWidth(annotation)).map((p) => pdfToScreen(p.x, p.y, transform));
  ctx.save();
  ctx.globalAlpha = annotation.opacity;
  ctx.fillStyle = annotation.background;
  ctx.beginPath();
  quad.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
  ctx.fill();
  if (annotation.text) {
    // Local axes: +x along the baseline, +y down (screen-like), in PDF points.
    const o = annotation.origin;
    const dx = Math.cos(annotation.angle);
    const dy = Math.sin(annotation.angle);
    const origin = pdfToScreen(o.x, o.y, transform);
    const alongPt = pdfToScreen(o.x + dx, o.y + dy, transform);
    const downPt = pdfToScreen(o.x + dy, o.y - dx, transform);
    ctx.transform(alongPt.x - origin.x, alongPt.y - origin.y, downPt.x - origin.x, downPt.y - origin.y, origin.x, origin.y);
    ctx.font = cssFont(annotation);
    matchPdfText(ctx);
    ctx.fillStyle = annotation.color;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(annotation.text, 0, 0);
  }
  ctx.restore();
}

// ─── Measurement ─────────────────────────────────────────────────────────────

export function renderMeasure(
  ctx: CanvasRenderingContext2D,
  annotation: MeasureAnnotation,
  transform: PageTransform,
): void {
  const pts = annotation.points.map((p) => pdfToScreen(p.x, p.y, transform));
  if (pts.length < 2) return;
  const s = transform.scale;
  ctx.save();
  ctx.globalAlpha = annotation.opacity;
  ctx.strokeStyle = annotation.color;
  ctx.lineWidth = annotation.strokeWidth * s;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  if (annotation.kind === 'area') {
    ctx.closePath();
    ctx.save();
    ctx.globalAlpha = annotation.opacity * 0.14;
    ctx.fillStyle = annotation.color;
    ctx.fill();
    ctx.restore();
  }
  ctx.stroke();
  if (annotation.kind === 'distance') {
    ctx.beginPath();
    for (const [a, b] of measureTicks(annotation.points[0], annotation.points[1])) {
      const p = pdfToScreen(a.x, a.y, transform);
      const q = pdfToScreen(b.x, b.y, transform);
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
    }
    ctx.stroke();
  }
  // Label in a white pill, always upright.
  const label = measureLabel(annotation);
  const anchor = labelAnchor(annotation);
  const c = pdfToScreen(anchor.x, anchor.y, transform);
  const fontPx = MEASURE_FONT * s;
  ctx.font = `600 ${fontPx}px -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif`;
  const w = ctx.measureText(label).width + fontPx * 0.9;
  const h = fontPx * 1.5;
  ctx.globalAlpha = annotation.opacity;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.beginPath();
  ctx.roundRect(c.x - w / 2, c.y - h / 2, w, h, h / 2);
  ctx.fill();
  ctx.lineWidth = Math.max(1, s * 0.75);
  ctx.stroke();
  ctx.fillStyle = annotation.color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, c.x, c.y + fontPx * 0.04);
  ctx.restore();
}

// ─── Sticky note ──────────────────────────────────────────────────────────────

export function renderNote(
  ctx: CanvasRenderingContext2D,
  annotation: NoteAnnotation,
  transform: PageTransform,
): void {
  // Always upright on screen, whatever the page rotation.
  const r = pdfRectToScreenBounds({ x: annotation.x, y: annotation.y, width: NOTE_ICON_SIZE, height: NOTE_ICON_SIZE }, transform);
  const size = Math.min(r.width, r.height);
  const ox = r.x;
  const oy = r.y;
  const dark = noteShade(annotation.color);
  ctx.save();
  ctx.globalAlpha = annotation.opacity;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = size * 0.12;
  ctx.shadowOffsetY = size * 0.05;
  for (const part of NOTE_ICON_PATHS) {
    const path = new Path2D();
    part.points.forEach(([u, v], i) => {
      const x = ox + u * size;
      const y = oy + v * size;
      if (i === 0) path.moveTo(x, y); else path.lineTo(x, y);
    });
    if (part.closed) path.closePath();
    ctx.lineWidth = NOTE_ICON_STROKE * size;
    ctx.strokeStyle = dark;
    if (part.role === 'body') {
      ctx.fillStyle = annotation.color;
      ctx.fill(path);
      ctx.shadowColor = 'transparent';
      ctx.stroke(path);
    } else if (part.role === 'fold') {
      ctx.fillStyle = dark;
      ctx.fill(path);
    } else {
      ctx.stroke(path);
    }
  }
  ctx.restore();
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

  // Border
  const borderWidth = annotation.borderWidth ?? 0;
  if (borderWidth > 0 && annotation.borderColor && annotation.borderColor !== 'transparent') {
    ctx.strokeStyle = annotation.borderColor;
    ctx.lineWidth = borderWidth;
    ctx.strokeRect(borderWidth / 2, borderWidth / 2, bounds.width - borderWidth, bounds.height - borderWidth);
  }

  // Text (shared layout with the exporter and auto-sizing)
  ctx.font = cssFont(annotation);
  matchPdfText(ctx);
  ctx.fillStyle = annotation.color;
  ctx.textBaseline = 'top';
  const measure = (text: string) => ctx.measureText(text).width;
  const innerWidth = bounds.width - TEXT_PADDING * 2;
  const lineAdvance = annotation.fontSize * LINE_HEIGHT;
  let lineY = TEXT_PADDING;

  for (const line of layoutTextLines(annotation.content, annotation.listStyle, innerWidth, measure)) {
    const textWidth = measure(line.text);
    let textX = TEXT_PADDING + line.indent;
    if (annotation.align === 'center') {
      textX = TEXT_PADDING + line.indent + (innerWidth - line.indent - textWidth) / 2;
    } else if (annotation.align === 'right') {
      textX = bounds.width - TEXT_PADDING - textWidth;
    }
    if (line.marker) ctx.fillText(line.marker, TEXT_PADDING, lineY);
    ctx.fillText(line.text, textX, lineY);

    if (annotation.underline && line.text) {
      ctx.beginPath();
      ctx.moveTo(textX, lineY + annotation.fontSize + 1);
      ctx.lineTo(textX + textWidth, lineY + annotation.fontSize + 1);
      ctx.strokeStyle = annotation.color;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    lineY += lineAdvance;
  }
  ctx.restore();
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
