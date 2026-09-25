/**
 * annotationExporter.ts — Flatten annotations into a new PDF using pdf-lib
 *
 * Export flow:
 *   1. Load original PDF bytes via pdf-lib
 *   2. For each page, get all annotations from AnnotationStore
 *   3. Serialize canonical PDF User Space coordinates directly through pdf-lib
 *   4. Embed the drawings into the PDF page content stream
 *   5. Return the modified PDF as Uint8Array
 *   6. Caller writes it to disk via Electron IPC
 *
 * Coordinate system invariants:
 *   - Annotations and pdf-lib drawing operators share canonical PDF User Space
 *   - Intrinsic /Rotate remains page metadata and is never reapplied to geometry
 *   - Display rotation is view-only state and is not accepted by this boundary
 *   - CropBox and MediaBox origins remain absolute and are never normalized away
 *
 * Per-annotation rendering strategy:
 *   stroke      → direct PDF line segments (optionally pressure-weighted)
 *   highlight   → thick PDF line segments using Multiply blend mode
 *   text        → drawText() with line wrapping matching the canvas renderer
 *   shape/line  → drawLine()
 *   shape/arrow → drawLine() + arrowhead triangle
 *   shape/rect  → drawRectangle()
 *   shape/roundedRect → rounded SVG path positioned in PDF User Space
 *   shape/ellipse → drawEllipse()
 */

import {
  PDFDocument,
  rgb,
  StandardFonts,
  LineCapStyle,
  BlendMode,
  PDFName,
  PDFNumber,
} from 'pdf-lib';
import type { PDFPage, PDFImage } from 'pdf-lib';
import type {
  Annotation,
  StrokeAnnotation,
  HighlightAnnotation,
  TextAnnotation,
  ShapeAnnotation,
  ImageAnnotation,
  InputPoint,
  DocumentAnnotationState,
} from '../types/annotations';
import type { ImageAsset } from '../store/assetStore';

export type ImageAssetResolver =
  | Map<string, ImageAsset>
  | ((assetId: string) => ImageAsset | undefined);

export interface ExportAnnotatedPdfOptions {
  assets?: ImageAssetResolver;
}

// ─── Types ─────────────────────────────────────────────────────────────────────

/** All annotations for the whole document, keyed by page index. */
export type DocumentAnnotations = ReadonlyMap<number, readonly Annotation[]>;

export interface ExportResult {
  data: Uint8Array;
  pageCount: number;
  annotationCount: number;
}

export type AnnotationExportErrorCode =
  | 'INVALID_ANNOTATION'
  | 'ANNOTATION_SERIALIZATION_FAILED'
  | 'SOURCE_ALREADY_FLATTENED';

/** Stable error contract for Save/Export callers. No annotation is silently lost. */
export class AnnotationExportError extends Error {
  readonly name = 'AnnotationExportError';

  constructor(
    readonly code: AnnotationExportErrorCode,
    message: string,
    readonly annotationId?: string,
    readonly pageIndex?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export interface PdfPageExportContext {
  readonly intrinsicRotation: number;
  readonly mediaBox: Readonly<{ x: number; y: number; width: number; height: number }>;
  readonly cropBox: Readonly<{ x: number; y: number; width: number; height: number }>;
}

const EXPORT_MARKER = PDFName.of('MaliPDFExport');

// ─── Color parsing ─────────────────────────────────────────────────────────────

/**
 * Parse a CSS hex color string (#rgb, #rrggbb, #rrggbbaa) into pdf-lib rgb().
 * Invalid colors are rejected so exports cannot silently change appearance.
 */
function parseCssColor(cssColor: string): ReturnType<typeof rgb> {
  if (!cssColor || cssColor === 'transparent') {
    throw new Error(`Expected an opaque CSS hex color; received ${cssColor || 'empty value'}.`);
  }

  const hex = cssColor.replace('#', '').trim();

  let r = 0, g = 0, b = 0;

  if (hex.length === 3) {
    r = parseInt(hex[0] + hex[0], 16) / 255;
    g = parseInt(hex[1] + hex[1], 16) / 255;
    b = parseInt(hex[2] + hex[2], 16) / 255;
  } else if (hex.length === 6 || hex.length === 8) {
    r = parseInt(hex.substring(0, 2), 16) / 255;
    g = parseInt(hex.substring(2, 4), 16) / 255;
    b = parseInt(hex.substring(4, 6), 16) / 255;
  } else {
    throw new Error(`Unsupported CSS color: ${cssColor}.`);
  }

  if (![r, g, b].every(Number.isFinite)) throw new Error(`Invalid CSS color: ${cssColor}.`);

  // Clamp
  r = Math.max(0, Math.min(1, r));
  g = Math.max(0, Math.min(1, g));
  b = Math.max(0, Math.min(1, b));

  return rgb(r, g, b);
}

// ─── Page info helper ──────────────────────────────────────────────────────────

export function createPdfPageExportContext(page: PDFPage): PdfPageExportContext {
  return {
    intrinsicRotation: normalizeQuarterTurn(page.getRotation().angle),
    mediaBox: Object.freeze({ ...page.getMediaBox() }),
    cropBox: Object.freeze({ ...page.getCropBox() }),
  };
}

/** pdf-lib content operators use the same default PDF User Space as annotations. */
export function annotationPointToExportPoint(pdfX: number, pdfY: number): { x: number; y: number } {
  assertFinite(pdfX, 'annotation x');
  assertFinite(pdfY, 'annotation y');
  return { x: pdfX, y: pdfY };
}

export function annotationRectToExportRect(rect: Readonly<{ x: number; y: number; width: number; height: number }>) {
  for (const [label, value] of Object.entries(rect)) assertFinite(value, `annotation rect ${label}`);
  const x2 = rect.x + rect.width;
  const y2 = rect.y + rect.height;
  return {
    x: Math.min(rect.x, x2),
    y: Math.min(rect.y, y2),
    width: Math.abs(rect.width),
    height: Math.abs(rect.height),
  };
}

function normalizeQuarterTurn(rotation: number): number {
  const normalized = ((rotation % 360) + 360) % 360;
  if (!Number.isFinite(rotation) || normalized % 90 !== 0) {
    throw new Error(`PDF page rotation must be a multiple of 90; received ${rotation}.`);
  }
  return normalized;
}

function toLib(pdfX: number, pdfY: number, _context: PdfPageExportContext): { x: number; y: number } {
  return annotationPointToExportPoint(pdfX, pdfY);
}

/** Matches the committed-canvas Catmull-Rom interpolation in PDF space. */
function smoothAnnotationPoints(points: readonly InputPoint[]): InputPoint[] {
  if (points.length < 3) return [...points];
  const result: InputPoint[] = [{ ...points[0] }];
  for (let index = 0; index < points.length - 1; index++) {
    const p0 = points[Math.max(index - 1, 0)];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[Math.min(index + 2, points.length - 1)];
    for (let step = 1; step <= 8; step++) {
      const s = step / 8;
      const s2 = s * s;
      const s3 = s2 * s;
      result.push({
        x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * s +
          (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * s2 +
          (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * s3),
        y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * s +
          (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * s2 +
          (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * s3),
        pressure: p1.pressure + (p2.pressure - p1.pressure) * s,
        timestamp: p1.timestamp,
      });
    }
  }
  result.push({ ...points[points.length - 1] });
  return result;
}

// ─── Stroke annotation ─────────────────────────────────────────────────────────

/**
 * Draw a stroke annotation as a PDF path.
 *
 * Approach: draw each segment individually to support variable opacity
 * and match the canvas rendering as closely as possible.
 *
 * pdf-lib does not support variable width inside one path, so pressure strokes
 * are emitted as adjacent segments using the same width formula as canvas.
 */
function exportStroke(
  page: PDFPage,
  annotation: StrokeAnnotation,
  info: PdfPageExportContext,
): void {
  const { color, width, opacity } = annotation;
  const points = annotation.smooth ? smoothAnnotationPoints(annotation.points) : annotation.points;
  if (points.length < 2) return;

  const strokeColor = parseCssColor(color);

  // For pressure-sensitive strokes, segment into groups with averaged width
  // This approximates the variable width rendering better than a single width
  if (annotation.pressure && points.some(p => p.pressure !== 0.5)) {
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      const segWidth = width * (0.3 + p0.pressure * 1.4);
      const start = toLib(p0.x, p0.y, info);
      const end   = toLib(p1.x, p1.y, info);
      page.drawLine({
        start,
        end,
        thickness: segWidth,
        color: strokeColor,
        opacity,
        lineCap: LineCapStyle.Round,
      });
    }
    return;
  }

  // Draw direct PDF line operators. drawSvgPath uses SVG's inverted Y axis and
  // would mirror canonical PDF-space pen points.
  const libPoints = points.map(p => toLib(p.x, p.y, info));
  for (let index = 0; index < libPoints.length - 1; index++) {
    page.drawLine({
      start: libPoints[index],
      end: libPoints[index + 1],
      thickness: width,
      color: strokeColor,
      opacity,
      lineCap: LineCapStyle.Round,
    });
  }
}

// ─── Highlight annotation ──────────────────────────────────────────────────────

/**
 * Draw a highlight annotation.
 *
 * The canvas renderer uses globalCompositeOperation='multiply' for highlights.
 * pdf-lib supports BlendMode.Multiply for similar effect.
 *
 * We draw the highlight as a thick stroke with the Multiply blend mode.
 */
function exportHighlight(
  page: PDFPage,
  annotation: HighlightAnnotation,
  info: PdfPageExportContext,
): void {
  const { color, width, opacity } = annotation;
  const points = smoothAnnotationPoints(annotation.points);
  if (points.length < 2) return;

  const highlightColor = parseCssColor(color);
  const libPoints = points.map(p => toLib(p.x, p.y, info));

  // Draw each segment with multiply blend mode
  for (let i = 0; i < libPoints.length - 1; i++) {
    page.drawLine({
      start: libPoints[i],
      end:   libPoints[i + 1],
      thickness: width,
      color: highlightColor,
      opacity,
      lineCap: LineCapStyle.Butt,
      blendMode: BlendMode.Multiply,
    });
  }
}

// ─── Text annotation ───────────────────────────────────────────────────────────

/**
 * Draw a text annotation.
 *
 * pdf-lib has limited font support (only Standard14 fonts).
 * We map common font families to StandardFonts and support bold/italic variants.
 * Multi-line text is supported by splitting on '\n' and calculating line height.
 *
 * Limitation: pdf-lib cannot embed arbitrary system fonts (e.g., Inter).
 * We map to the closest standard font. Custom font embedding would require
 * fetching the font file as ArrayBuffer — a future enhancement.
 */
async function exportText(
  page: PDFPage,
  pdfDoc: PDFDocument,
  annotation: TextAnnotation,
  info: PdfPageExportContext,
): Promise<void> {
  const { bounds, content, fontSize, bold, italic, color, opacity, align } = annotation;
  // Map to closest available StandardFonts
  let fontName: StandardFonts;
  if (bold && italic) {
    fontName = StandardFonts.HelveticaBoldOblique;
  } else if (bold) {
    fontName = StandardFonts.HelveticaBold;
  } else if (italic) {
    fontName = StandardFonts.HelveticaOblique;
  } else {
    fontName = StandardFonts.Helvetica;
  }

  const font = await pdfDoc.embedFont(fontName);

  // Background fill
  if (annotation.backgroundColor !== 'transparent') {
    const bgColor = parseCssColor(annotation.backgroundColor);
    const background = annotationRectToExportRect(bounds);
    page.drawRectangle({
      x: background.x,
      y: background.y,
      width: background.width,
      height: background.height,
      color: bgColor,
      opacity,
    });
  }

  const textColor = parseCssColor(color);
  const lineHeight = fontSize * 1.4;

  // Split on explicit newlines first
  const paragraphs = content.split('\n');
  let lineIndex = 0;
  const PADDING = 4; // PDF points
  const maxWidth = Math.max(0.1, bounds.width - PADDING * 2);

  // We draw from the TOP of the bounds downward.
  // In pdf-lib (Y-up), the top of the bounds in lib coords is bounds.y + bounds.height.
  // Each line descends by lineHeight.
  const topLibPt = toLib(bounds.x, bounds.y + bounds.height, info);

  for (const paragraph of paragraphs) {
    // Simple word-wrap
    const wrappedLines = wrapTextPdfLib(paragraph, maxWidth, fontSize, font);
    for (const line of wrappedLines) {
      const lineY = topLibPt.y - PADDING - lineIndex * lineHeight - fontSize;
      if (lineY < toLib(bounds.x, bounds.y, info).y) break; // clamp to bounds

      // X alignment
      let textX = topLibPt.x + PADDING;
      if (align === 'center' || align === 'right') {
        const textWidth = font.widthOfTextAtSize(line, fontSize);
        if (align === 'center') {
          textX = topLibPt.x + (maxWidth - textWidth) / 2 + PADDING;
        } else {
          textX = topLibPt.x + maxWidth - textWidth + PADDING;
        }
      }

      page.drawText(line, {
        x: textX,
        y: lineY,
        size: fontSize,
        font,
        color: textColor,
        opacity,
      });

      // Underline
      if (annotation.underline) {
        const textWidth = font.widthOfTextAtSize(line, fontSize);
        page.drawLine({
          start: { x: textX, y: lineY - 1 },
          end:   { x: textX + textWidth, y: lineY - 1 },
          thickness: 0.5,
          color: textColor,
          opacity,
        });
      }

      lineIndex++;
    }
  }
}

/**
 * Simple word-wrap for pdf-lib text.
 * Uses pdf-lib font.widthOfTextAtSize for accurate measurement.
 */
function wrapTextPdfLib(
  text: string,
  maxWidth: number,
  fontSize: number,
  font: Awaited<ReturnType<PDFDocument['embedFont']>>,
): string[] {
  if (!text) return [''];
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const width = font.widthOfTextAtSize(testLine, fontSize);
    if (width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines.length > 0 ? lines : [''];
}

// ─── Shape annotation ──────────────────────────────────────────────────────────

function exportShape(
  page: PDFPage,
  annotation: ShapeAnnotation,
  info: PdfPageExportContext,
): void {
  const {
    shapeKind,
    startPoint,
    endPoint,
    color,
    strokeWidth,
    fillColor,
    opacity,
  } = annotation;

  const strokeColor = parseCssColor(color);
  const hasFill = fillColor !== 'transparent';
  const fillColorParsed = hasFill ? parseCssColor(fillColor) : undefined;

  let dashArray: number[] | undefined;
  if (annotation.borderStyle && annotation.borderStyle !== 'solid') {
    switch (annotation.borderStyle) {
      case 'dashed': dashArray = [strokeWidth * 4, strokeWidth * 3]; break;
      case 'dotted': dashArray = [strokeWidth, strokeWidth * 2]; break;
      case 'dash-dot': dashArray = [strokeWidth * 4, strokeWidth * 3, strokeWidth, strokeWidth * 3]; break;
      case 'dash-dot-dot': dashArray = [strokeWidth * 4, strokeWidth * 3, strokeWidth, strokeWidth * 3, strokeWidth, strokeWidth * 3]; break;
    }
  }

  const start = toLib(startPoint.x, startPoint.y, info);
  const end   = toLib(endPoint.x, endPoint.y, info);

  // Normalized rect corners (robust to drag direction)
  const rx = Math.min(start.x, end.x);
  const ry = Math.min(start.y, end.y);
  const rw = Math.abs(end.x - start.x);
  const rh = Math.abs(end.y - start.y);

  switch (shapeKind) {
    case 'line':
      page.drawLine({
        start,
        end,
        thickness: strokeWidth,
        color: strokeColor,
        opacity,
        lineCap: LineCapStyle.Round,
        dashArray,
      });
      break;

    case 'arrow':
      exportArrow(page, start, end, strokeWidth, strokeColor, opacity);
      break;

    case 'rectangle':
      page.drawRectangle({
        x: rx,
        y: ry,
        width: rw,
        height: rh,
        borderColor: strokeColor,
        borderWidth: strokeWidth,
        borderLineCap: LineCapStyle.Projecting,
        color: fillColorParsed,
        opacity,
        borderOpacity: opacity,
        borderDashArray: dashArray,
      });
      break;

    case 'roundedRect': {
      const maxR = Math.min(rw, rh) / 2;
      const cornerRadius = Math.min(annotation.cornerRadius ?? 8, maxR);
      const k = 0.5522847498;
      const w = rw;
      const h = rh;
      const r = cornerRadius;
      const path = [
        `M ${r} 0`, `L ${w - r} 0`,
        `C ${w - r + r * k} 0 ${w} ${r - r * k} ${w} ${r}`,
        `L ${w} ${h - r}`,
        `C ${w} ${h - r + r * k} ${w - r + r * k} ${h} ${w - r} ${h}`,
        `L ${r} ${h}`,
        `C ${r - r * k} ${h} 0 ${h - r + r * k} 0 ${h - r}`,
        `L 0 ${r}`,
        `C 0 ${r - r * k} ${r - r * k} 0 ${r} 0 Z`,
      ].join(' ');
      // drawSvgPath has a local SVG Y-down axis. Anchoring at PDF top-left
      // maps the local path back into the canonical PDF rectangle.
      page.drawSvgPath(path, {
        x: rx,
        y: ry + rh,
        borderColor: strokeColor,
        borderWidth: strokeWidth,
        borderLineCap: LineCapStyle.Round,
        color: fillColorParsed,
        opacity,
        borderOpacity: opacity,
        borderDashArray: dashArray,
      });
      break;
    }

    case 'ellipse':
      if (rw > 0 && rh > 0) {
        page.drawEllipse({
          x: rx + rw / 2,
          y: ry + rh / 2,
          xScale: rw / 2,
          yScale: rh / 2,
          borderColor: strokeColor,
          borderWidth: strokeWidth,
          color: fillColorParsed,
          opacity,
          borderOpacity: opacity,
          borderDashArray: dashArray,
        });
      }
      break;
  }
}

/**
 * Draw an arrow: a line with a filled arrowhead triangle at the end point.
 */
function exportArrow(
  page: PDFPage,
  start: { x: number; y: number },
  end:   { x: number; y: number },
  lineWidth: number,
  color: ReturnType<typeof rgb>,
  opacity: number,
): void {
  // Main line
  page.drawLine({
    start,
    end,
    thickness: lineWidth,
    color,
    opacity,
    lineCap: LineCapStyle.Round,
  });

  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const headLength = Math.max(12, lineWidth * 4);
  const headAngle = Math.PI / 6; // 30°

  // Arrowhead as two lines
  const wing1 = {
    x: end.x - headLength * Math.cos(angle - headAngle),
    y: end.y - headLength * Math.sin(angle - headAngle),
  };
  const wing2 = {
    x: end.x - headLength * Math.cos(angle + headAngle),
    y: end.y - headLength * Math.sin(angle + headAngle),
  };

  page.drawLine({ start: end, end: wing1, thickness: lineWidth, color, opacity, lineCap: LineCapStyle.Round });
  page.drawLine({ start: end, end: wing2, thickness: lineWidth, color, opacity, lineCap: LineCapStyle.Round });
}

// ─── Image annotation export ──────────────────────────────────────────────────

function exportImage(
  page: PDFPage,
  img: PDFImage,
  annotation: ImageAnnotation,
  _info: PdfPageExportContext,
): void {
  page.drawImage(img, {
    x: annotation.x,
    y: annotation.y,
    width: annotation.width,
    height: annotation.height,
    opacity: annotation.opacity ?? 1,
  });
}

// ─── Main export function ──────────────────────────────────────────────────────

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite; received ${value}.`);
}

function assertPositive(value: number, label: string): void {
  assertFinite(value, label);
  if (value <= 0) throw new Error(`${label} must be greater than zero; received ${value}.`);
}

function validatePoint(pointValue: InputPoint | { x: number; y: number }, label: string): void {
  assertFinite(pointValue.x, `${label}.x`);
  assertFinite(pointValue.y, `${label}.y`);
  if ('pressure' in pointValue) {
    assertFinite(pointValue.pressure, `${label}.pressure`);
    if (pointValue.pressure < 0 || pointValue.pressure > 1) {
      throw new Error(`${label}.pressure must be between 0 and 1.`);
    }
  }
}

function validateAnnotation(annotation: Annotation, pageIndex: number): void {
  if (!annotation.id || typeof annotation.id !== 'string') throw new Error('Annotation id must be a non-empty string.');
  if (annotation.pageIndex !== pageIndex) {
    throw new Error(`Annotation pageIndex ${annotation.pageIndex} does not match map page ${pageIndex}.`);
  }
  assertFinite(annotation.opacity, 'annotation opacity');
  if (annotation.opacity < 0 || annotation.opacity > 1) throw new Error('Annotation opacity must be between 0 and 1.');
  parseCssColor(annotation.color);

  switch (annotation.type) {
    case 'stroke':
      assertPositive(annotation.width, 'stroke width');
      if (annotation.points.length < 2) throw new Error('Stroke requires at least two points.');
      annotation.points.forEach((value, index) => validatePoint(value, `stroke point ${index}`));
      return;
    case 'highlight':
      assertPositive(annotation.width, 'highlight width');
      if (annotation.points.length < 2) throw new Error('Highlight requires at least two points.');
      annotation.points.forEach((value, index) => validatePoint(value, `highlight point ${index}`));
      return;
    case 'text':
      if (!annotation.content.trim()) throw new Error('Text annotation content must not be empty.');
      assertPositive(annotation.bounds.width, 'text bounds width');
      assertPositive(annotation.bounds.height, 'text bounds height');
      assertFinite(annotation.bounds.x, 'text bounds x');
      assertFinite(annotation.bounds.y, 'text bounds y');
      assertPositive(annotation.fontSize, 'text font size');
      if (annotation.backgroundColor !== 'transparent') parseCssColor(annotation.backgroundColor);
      return;
    case 'shape':
      validatePoint(annotation.startPoint, 'shape startPoint');
      validatePoint(annotation.endPoint, 'shape endPoint');
      assertPositive(annotation.strokeWidth, 'shape stroke width');
      if (!['line', 'arrow', 'rectangle', 'roundedRect', 'ellipse'].includes(annotation.shapeKind)) {
        throw new Error(`Unsupported shape kind: ${String(annotation.shapeKind)}.`);
      }
      if (annotation.fillColor !== 'transparent') parseCssColor(annotation.fillColor);
      return;
    case 'image':
      assertPositive(annotation.width, 'image width');
      assertPositive(annotation.height, 'image height');
      assertFinite(annotation.x, 'image x');
      assertFinite(annotation.y, 'image y');
      if (!annotation.assetId || typeof annotation.assetId !== 'string') {
        throw new Error('Image annotation requires a valid assetId string.');
      }
      return;
    default:
      throw new Error(`Unsupported annotation type: ${String((annotation as Annotation).type)}.`);
  }
}

function cloneAnnotation(annotation: Annotation): Annotation {
  switch (annotation.type) {
    case 'stroke':
    case 'highlight':
      return Object.freeze({
        ...annotation,
        points: Object.freeze(annotation.points.map((value) => Object.freeze({ ...value }))),
      }) as unknown as Annotation;
    case 'text':
      return Object.freeze({ ...annotation, bounds: Object.freeze({ ...annotation.bounds }) }) as Annotation;
    case 'shape':
      return Object.freeze({
        ...annotation,
        startPoint: Object.freeze({ ...annotation.startPoint }),
        endPoint: Object.freeze({ ...annotation.endPoint }),
      }) as Annotation;
    case 'image':
      return Object.freeze({ ...annotation }) as Annotation;
    default:
      // Preserve unknown runtime data so validation can produce a typed error
      // containing the original annotation identity instead of throwing here.
      return Object.freeze({ ...(annotation as unknown as Record<string, unknown>) }) as unknown as Annotation;
  }
}

export function createAnnotationSnapshot(annotations: DocumentAnnotations): DocumentAnnotations {
  const snapshot = new Map<number, readonly Annotation[]>();
  for (const [pageIndex, pageAnnotations] of annotations) {
    snapshot.set(pageIndex, Object.freeze(pageAnnotations.map(cloneAnnotation)));
  }
  return snapshot;
}

function annotationCount(annotations: DocumentAnnotations): number {
  let count = 0;
  for (const pageAnnotations of annotations.values()) count += pageAnnotations.length;
  return count;
}

function assertSourceNotPreviouslyFlattened(pdfDoc: PDFDocument, count: number): void {
  if (count > 0 && pdfDoc.catalog.get(EXPORT_MARKER)) {
    throw new AnnotationExportError(
      'SOURCE_ALREADY_FLATTENED',
      'The source PDF already contains a MaliPDF flattened export. Reusing it with live annotations would duplicate content.',
    );
  }
}

function markFlattenedExport(pdfDoc: PDFDocument, count: number): void {
  if (count === 0) return;
  pdfDoc.catalog.set(EXPORT_MARKER, pdfDoc.context.obj({
    Version: PDFNumber.of(1),
    AnnotationCount: PDFNumber.of(count),
  }));
}

/**
 * Export a PDF document with annotations flattened into the page content.
 *
 * @param sourceData   - Original PDF bytes (from DocumentState.sourceData)
 * @param annotations  - Map from pageIndex → annotation array
 * @returns ExportResult with the modified PDF bytes
 */
export async function exportAnnotatedPdf(
  sourceData: Uint8Array,
  annotations: DocumentAnnotations,
  options?: ExportAnnotatedPdfOptions,
): Promise<ExportResult> {
  // Capture annotation state synchronously, before the first async boundary.
  const snapshot = createAnnotationSnapshot(annotations);
  const requestedAnnotationCount = annotationCount(snapshot);

  // Load a copy so pdf-lib can never detach or mutate DocumentState.sourceData.
  const pdfDoc = await PDFDocument.load(sourceData.slice(), {
    ignoreEncryption: false,
  });

  const pages = pdfDoc.getPages();
  assertSourceNotPreviouslyFlattened(pdfDoc, requestedAnnotationCount);

  for (const [pageIndex, pageAnnotations] of snapshot) {
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pages.length) {
      throw new AnnotationExportError(
        'INVALID_ANNOTATION',
        `Annotation page ${pageIndex} is outside the source PDF page range.`,
        pageAnnotations[0]?.id,
        pageIndex,
      );
    }
    for (const annotation of pageAnnotations) {
      try {
        validateAnnotation(annotation, pageIndex);
      } catch (cause) {
        throw new AnnotationExportError(
          'INVALID_ANNOTATION',
          `Invalid annotation ${annotation.id} on page ${pageIndex}: ${cause instanceof Error ? cause.message : String(cause)}`,
          annotation.id,
          pageIndex,
          { cause },
        );
      }
    }
  }

  let totalAnnotationCount = 0;
  // Deduplicate embedded images across all annotations
  const embeddedImages = new Map<string, PDFImage>();

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex];
    const info = createPdfPageExportContext(page);

    const pageAnnotations = snapshot.get(pageIndex) || [];
    if (pageAnnotations.length === 0) continue;

    for (const annotation of pageAnnotations) {
      try {
        switch (annotation.type) {
          case 'stroke':
            exportStroke(page, annotation, info);
            break;
          case 'highlight':
            exportHighlight(page, annotation, info);
            break;
          case 'text':
            await exportText(page, pdfDoc, annotation, info);
            break;
          case 'shape':
            exportShape(page, annotation, info);
            break;
          case 'image': {
            let pdfImg = embeddedImages.get(annotation.assetId);
            if (!pdfImg) {
              let asset: ImageAsset | undefined;
              if (options?.assets instanceof Map) {
                asset = options.assets.get(annotation.assetId);
              } else if (typeof options?.assets === 'function') {
                asset = options.assets(annotation.assetId);
              }
              if (!asset) {
                throw new Error(`Image asset ${annotation.assetId} not found for export.`);
              }
              if (asset.mimeType === 'image/jpeg') {
                pdfImg = await pdfDoc.embedJpg(asset.data);
              } else {
                pdfImg = await pdfDoc.embedPng(asset.data);
              }
              embeddedImages.set(annotation.assetId, pdfImg);
            }
            exportImage(page, pdfImg, annotation, info);
            break;
          }
        }
        totalAnnotationCount++;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        throw new AnnotationExportError(
          'ANNOTATION_SERIALIZATION_FAILED',
          `Failed to export annotation ${annotation.id} (type=${annotation.type}) on page ${pageIndex}: ${errMsg}`,
          annotation.id,
          pageIndex,
          { cause: err },
        );
      }
    }
  }

  markFlattenedExport(pdfDoc, totalAnnotationCount);
  const pdfBytes = await pdfDoc.save();
  return {
    data: pdfBytes,
    pageCount: pages.length,
    annotationCount: totalAnnotationCount,
  };
}

// ─── High-level export + save orchestration ────────────────────────────────────

/**
 * Build a DocumentAnnotations map from the annotation store's data.
 *
 * @param docAnnotationState - The DocumentAnnotationState from annotationStore
 */
export function buildAnnotationsMap(
  docAnnotationState: DocumentAnnotationState,
): DocumentAnnotations {
  const result = new Map<number, readonly Annotation[]>();
  for (const [pageIndex, pageState] of docAnnotationState.pages) {
    if (pageState.annotations.length > 0) {
      result.set(pageIndex, pageState.annotations);
    }
  }
  return createAnnotationSnapshot(result);
}

/**
 * Run the full export + save flow:
 * 1. Build annotations map
 * 2. Export annotated PDF bytes
 * 3. Show native Save As dialog via Electron
 * 4. Write file to disk
 *
 * @param sourceData    - Original PDF bytes
 * @param docAnnotState - DocumentAnnotationState from store
 * @param defaultName   - Suggested filename for the save dialog
 * @returns true if saved, false if cancelled, throws on error
 */
export async function exportAndSave(
  sourceData: Uint8Array,
  docAnnotState: DocumentAnnotationState,
  defaultName: string,
  options?: ExportAnnotatedPdfOptions,
): Promise<boolean> {
  const annotations = buildAnnotationsMap(docAnnotState);

  // Build the annotated PDF
  const result = await exportAnnotatedPdf(sourceData, annotations, options);

  // Ask the user where to save
  const savePath = await window.electronAPI.saveFile(defaultName);
  if (!savePath) return false; // user cancelled

  // Write to disk via Electron IPC
  const ok = await window.electronAPI.writeFile(savePath, result.data.buffer as ArrayBuffer);
  if (!ok) throw new Error('Failed to write PDF to disk.');

  return true;
}
