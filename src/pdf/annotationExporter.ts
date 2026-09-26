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
  PDFName,
  PDFNumber,
} from 'pdf-lib';
import {
  appendBezierCurve,
  closePath,
  fill as fillOp,
  LineJoinStyle,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  setFillingColor,
  setGraphicsState,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingColor,
  stroke as strokeOp,
} from 'pdf-lib';
import type { PDFPage, PDFImage, PDFFont, PDFOperator } from 'pdf-lib';
import type {
  Annotation,
  StrokeAnnotation,
  HighlightAnnotation,
  TextAnnotation,
  ShapeAnnotation,
  ImageAnnotation,
  FreeformAnnotation,
  InputPoint,
  DocumentAnnotationState,
  Bookmark,
} from '../types/annotations';
import type { ImageAsset } from '../store/assetStore';
import type { ExportFontSet } from './exportFonts';
import { fontFamilyKey, fontStyleKey, type FontFamilyKey, type FontStyleKey } from './fontFamilies';
import { layoutTextLines, LINE_HEIGHT, TEXT_PADDING } from './textLayout';
import { captureEditableState, writeEditableData, type EditableAsset } from './editableData';
import { appendBookmarksToOutline } from './outlineWriter';
import { highlightShape, penShape, type InkShape, type PathCommand } from './inkGeometry';

export type ImageAssetResolver =
  | Map<string, ImageAsset>
  | ((assetId: string) => ImageAsset | undefined);

export interface ExportAnnotatedPdfOptions {
  assets?: ImageAssetResolver;
  /**
   * Unicode fonts for Text annotations (see exportFonts.ts). Without them the
   * exporter falls back to Standard 14 Helvetica, which only covers WinAnsi.
   */
  fonts?: ExportFontSet;
  /**
   * Save (not Export): also store the live annotations so MaliPDF can reopen
   * the file with editable annotations (see editableData.ts).
   */
  editable?: boolean;
  /** User bookmarks, written into the PDF's table of contents. */
  bookmarks?: readonly Bookmark[];
}

function resolveAsset(resolver: ImageAssetResolver | undefined, assetId: string): ImageAsset | undefined {
  if (resolver instanceof Map) return resolver.get(assetId);
  if (typeof resolver === 'function') return resolver(assetId);
  return undefined;
}

/**
 * Loads the bundled Unicode export fonts without ever throwing. Returns
 * undefined when @pdf-lib/fontkit is not installed; Save/Export then fall back
 * to Standard 14 fonts and report a clear error only if a text needs them.
 */
export async function loadDefaultExportFonts(): Promise<ExportFontSet | undefined> {
  try {
    const module = await import('./exportFonts');
    return await module.loadExportFonts();
  } catch (error) {
    console.warn('[Export] Unicode export fonts unavailable:', error);
    return undefined;
  }
}

type TextFontResolver = (fontFamily: string, bold: boolean, italic: boolean) => Promise<PDFFont>;

const STANDARD_FONTS: Record<FontFamilyKey, Record<FontStyleKey, StandardFonts>> = {
  sans: {
    regular: StandardFonts.Helvetica, bold: StandardFonts.HelveticaBold,
    italic: StandardFonts.HelveticaOblique, boldItalic: StandardFonts.HelveticaBoldOblique,
  },
  serif: {
    regular: StandardFonts.TimesRoman, bold: StandardFonts.TimesRomanBold,
    italic: StandardFonts.TimesRomanItalic, boldItalic: StandardFonts.TimesRomanBoldItalic,
  },
  mono: {
    regular: StandardFonts.Courier, bold: StandardFonts.CourierBold,
    italic: StandardFonts.CourierOblique, boldItalic: StandardFonts.CourierBoldOblique,
  },
};

function createTextFontResolver(pdfDoc: PDFDocument, fonts: ExportFontSet | undefined): TextFontResolver {
  const cache = new Map<string, Promise<PDFFont>>();
  if (fonts) pdfDoc.registerFontkit(fonts.fontkit);
  return (fontFamily, bold, italic) => {
    const family = fontFamilyKey(fontFamily);
    const style = fontStyleKey(bold, italic);
    const key = `${family}:${style}`;
    let font = cache.get(key);
    if (!font) {
      font = fonts
        ? fonts.load(family, style).then((bytes) => pdfDoc.embedFont(bytes, { subset: true }))
        : pdfDoc.embedFont(STANDARD_FONTS[family][style]);
      cache.set(key, font);
    }
    return font;
  };
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

// ─── Ink (pen / highlighter) ──────────────────────────────────────────────────

/** Coordinates are written with 0.01 pt precision (keeps content streams small). */
const round2 = (value: number) => Math.round(value * 100) / 100;

const extGStateCache = new WeakMap<PDFPage, Map<string, PDFName>>();

/** One ExtGState per (opacity, blend) per page — not one per drawing call. */
function graphicsStateFor(page: PDFPage, opacity: number, blend?: 'Multiply'): PDFName | null {
  const alpha = Math.max(0, Math.min(1, opacity));
  if (alpha >= 1 && !blend) return null;
  let cache = extGStateCache.get(page);
  if (!cache) {
    cache = new Map();
    extGStateCache.set(page, cache);
  }
  const key = `${alpha}|${blend ?? ''}`;
  let name = cache.get(key);
  if (!name) {
    const dict = page.doc.context.obj({
      Type: 'ExtGState',
      CA: alpha,
      ca: alpha,
      ...(blend ? { BM: blend } : {}),
    });
    name = page.node.newExtGState('GS', dict);
    cache.set(key, name);
  }
  return name;
}

function pathOperators(commands: readonly PathCommand[], info: PdfPageExportContext): PDFOperator[] {
  const ops: PDFOperator[] = [];
  const p = (x: number, y: number) => {
    const point = toLib(x, y, info);
    return [round2(point.x), round2(point.y)] as const;
  };
  for (const c of commands) {
    if (c.op === 'M') ops.push(moveTo(...p(c.x, c.y)));
    else if (c.op === 'L') ops.push(lineTo(...p(c.x, c.y)));
    else if (c.op === 'C') ops.push(appendBezierCurve(...p(c.x1, c.y1), ...p(c.x2, c.y2), ...p(c.x, c.y)));
    else ops.push(closePath());
  }
  return ops;
}

/** Draws one ink shape as a single PDF path (one stroke or one fill). */
function drawInkShape(
  page: PDFPage,
  shape: InkShape,
  info: PdfPageExportContext,
  style: { color: string; width: number; opacity: number; blend?: 'Multiply'; cap: 'round' | 'butt' },
): void {
  if (shape.commands.length === 0) return;
  const color = parseCssColor(style.color);
  const gs = graphicsStateFor(page, style.opacity, style.blend);
  const ops: PDFOperator[] = [pushGraphicsState()];
  if (gs) ops.push(setGraphicsState(gs));
  if (shape.mode === 'stroke') {
    ops.push(
      setStrokingColor(color),
      setLineWidth(round2(style.width)),
      setLineCap(style.cap === 'round' ? LineCapStyle.Round : LineCapStyle.Butt),
      setLineJoin(LineJoinStyle.Round),
      ...pathOperators(shape.commands, info),
      strokeOp(),
    );
  } else {
    ops.push(setFillingColor(color), ...pathOperators(shape.commands, info), fillOp());
  }
  ops.push(popGraphicsState());
  page.pushOperators(...ops);
}

function exportStroke(
  page: PDFPage,
  annotation: StrokeAnnotation,
  info: PdfPageExportContext,
): void {
  const shape = penShape(annotation.points, annotation.width, annotation.smooth, annotation.pressure);
  drawInkShape(page, shape, info, { color: annotation.color, width: annotation.width, opacity: annotation.opacity, cap: 'round' });
}

function exportHighlight(
  page: PDFPage,
  annotation: HighlightAnnotation,
  info: PdfPageExportContext,
): void {
  drawInkShape(page, highlightShape(annotation.points), info, {
    color: annotation.color,
    width: annotation.width,
    opacity: annotation.opacity,
    blend: 'Multiply',
    cap: 'butt',
  });
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
  resolveFont: TextFontResolver,
  annotation: TextAnnotation,
  info: PdfPageExportContext,
): Promise<void> {
  const { bounds, content, fontSize, bold, italic, color, opacity, align } = annotation;
  const font = await resolveFont(annotation.fontFamily, bold, italic);
  try {
    font.encodeText(content.replace(/\n/g, ' '));
  } catch (cause) {
    throw new Error(
      'Text contains characters the built-in PDF font cannot encode '
      + '(for example Turkish ğ, ş, İ, ı). Unicode export fonts are not available; '
      + 'run "npm install" so @pdf-lib/fontkit is installed.',
      { cause },
    );
  }

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

  // Border
  const borderWidth = annotation.borderWidth ?? 0;
  if (borderWidth > 0 && annotation.borderColor && annotation.borderColor !== 'transparent') {
    const box = annotationRectToExportRect(bounds);
    page.drawRectangle({
      x: box.x + borderWidth / 2,
      y: box.y + borderWidth / 2,
      width: Math.max(0, box.width - borderWidth),
      height: Math.max(0, box.height - borderWidth),
      borderColor: parseCssColor(annotation.borderColor),
      borderWidth,
      borderOpacity: opacity,
    });
  }

  const textColor = parseCssColor(color);
  const lineHeight = fontSize * LINE_HEIGHT;
  const measure = (text: string) => font.widthOfTextAtSize(text, fontSize);
  const innerWidth = Math.max(0.1, bounds.width - TEXT_PADDING * 2);

  // Draw from the TOP of the bounds downward (pdf-lib is Y-up).
  const topLibPt = toLib(bounds.x, bounds.y + bounds.height, info);
  const bottomY = toLib(bounds.x, bounds.y, info).y;

  layoutTextLines(content, annotation.listStyle, innerWidth, measure).some((line, lineIndex) => {
    const lineY = topLibPt.y - TEXT_PADDING - lineIndex * lineHeight - fontSize;
    if (lineY < bottomY) return true; // clamp to bounds

    const textWidth = measure(line.text);
    let textX = topLibPt.x + TEXT_PADDING + line.indent;
    if (align === 'center') {
      textX = topLibPt.x + TEXT_PADDING + line.indent + (innerWidth - line.indent - textWidth) / 2;
    } else if (align === 'right') {
      textX = topLibPt.x + bounds.width - TEXT_PADDING - textWidth;
    }

    if (line.marker) {
      page.drawText(line.marker, { x: topLibPt.x + TEXT_PADDING, y: lineY, size: fontSize, font, color: textColor, opacity });
    }
    if (line.text) {
      page.drawText(line.text, { x: textX, y: lineY, size: fontSize, font, color: textColor, opacity });
    }

    if (annotation.underline && line.text) {
      page.drawLine({
        start: { x: textX, y: lineY - 1 },
        end:   { x: textX + textWidth, y: lineY - 1 },
        thickness: 0.5,
        color: textColor,
        opacity,
      });
    }
    return false;
  });
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

// ─── Freeform (polygon) annotation export ────────────────────────────────────

/**
 * Draw a closed polygon. drawSvgPath uses a local SVG (Y-down) axis anchored at
 * (x, y) = (0, 0); negating Y maps canonical PDF user-space points back 1:1.
 */
function exportFreeform(
  page: PDFPage,
  annotation: FreeformAnnotation,
  _info: PdfPageExportContext,
): void {
  const { points, color, strokeWidth, fillColor, opacity } = annotation;
  if (points.length < 2) return;
  const path = points
    .map((p, index) => `${index === 0 ? 'M' : 'L'} ${p.x} ${-p.y}`)
    .join(' ') + ' Z';
  const hasFill = fillColor !== 'transparent';
  page.drawSvgPath(path, {
    x: 0,
    y: 0,
    borderColor: parseCssColor(color),
    borderWidth: strokeWidth,
    borderLineCap: LineCapStyle.Round,
    color: hasFill ? parseCssColor(fillColor) : undefined,
    opacity,
    borderOpacity: opacity,
  });
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
      if (annotation.points.length < 1) throw new Error('Stroke requires at least one point.');
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
      if (annotation.borderColor && annotation.borderColor !== 'transparent') parseCssColor(annotation.borderColor);
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
    case 'freeform':
      assertPositive(annotation.strokeWidth, 'freeform stroke width');
      if (annotation.points.length < 2) throw new Error('Freeform requires at least two points.');
      annotation.points.forEach((value, index) => validatePoint(value, `freeform point ${index}`));
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
    case 'freeform':
      return Object.freeze({
        ...annotation,
        points: Object.freeze(annotation.points.map((value) => Object.freeze({ ...value }))),
      }) as unknown as Annotation;
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

  // Load a copy so pdf-lib can never detach or mutate DocumentState.sourceData.
  const pdfDoc = await PDFDocument.load(sourceData.slice(), {
    ignoreEncryption: false,
  });

  const pages = pdfDoc.getPages();
  const resolveTextFont = createTextFontResolver(pdfDoc, options?.fonts);
  // A source that already carries a MaliPDF export marker (a file saved earlier
  // and reopened) is valid input: its earlier annotations are now static page
  // content, and only the current live annotations are flattened on top.
  // In-session saves never feed flattened output back in as sourceData.

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

  const editableCapture = options?.editable ? captureEditableState(pdfDoc) : null;
  let totalAnnotationCount = 0;
  // Deduplicate embedded images across all annotations
  const embeddedImages = new Map<string, PDFImage>();

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex];
    const info = createPdfPageExportContext(page);

    // Hidden annotations (Annotations panel) are left out of the output.
    // Highlights go first (as on screen, where they sit under the ink layer):
    // they are multiplied onto the page and never cover pen, text or images.
    const visible = (snapshot.get(pageIndex) || []).filter((annotation) => !annotation.hidden);
    const pageAnnotations = [
      ...visible.filter((annotation) => annotation.type === 'highlight'),
      ...visible.filter((annotation) => annotation.type !== 'highlight'),
    ];
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
            await exportText(page, resolveTextFont, annotation, info);
            break;
          case 'shape':
            exportShape(page, annotation, info);
            break;
          case 'freeform':
            exportFreeform(page, annotation, info);
            break;
          case 'image': {
            let pdfImg = embeddedImages.get(annotation.assetId);
            if (!pdfImg) {
              const asset = resolveAsset(options?.assets, annotation.assetId);
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
  const bookmarks = options?.bookmarks ?? [];
  const outlineChange = appendBookmarksToOutline(pdfDoc, bookmarks);

  let keepEditable = false;
  if (editableCapture) {
    const all = [...snapshot.values()].flat();
    if (all.length > 0 || outlineChange) {
      const assets: EditableAsset[] = [];
      for (const assetId of new Set(all.flatMap((annotation) => (annotation.type === 'image' ? [annotation.assetId] : [])))) {
        const asset = resolveAsset(options?.assets, assetId);
        if (asset) assets.push({ id: asset.id, mimeType: asset.mimeType, width: asset.width, height: asset.height, data: asset.data });
      }
      writeEditableData(pdfDoc, editableCapture, all, assets, outlineChange ? bookmarks : [], outlineChange);
      keepEditable = true;
    }
  }
  // Editable saves keep the catalog outside object streams so reopening can
  // detect MaliPDF data with a cheap byte search.
  const pdfBytes = await pdfDoc.save(keepEditable ? { useObjectStreams: false } : undefined);
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
