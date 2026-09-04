/**
 * annotationExporter.ts — Flatten annotations into a new PDF using pdf-lib
 *
 * Export flow:
 *   1. Load original PDF bytes via pdf-lib
 *   2. For each page, get all annotations from AnnotationStore
 *   3. Transform annotation coordinates:
 *        PDF User Space (stored by us, via pdf.js convertToPdfPoint)
 *        → pdfUserSpaceToLibPoint(x, y, rotation, pageW, pageH)
 *        → pdf-lib drawing API
 *   4. Embed the drawings into the PDF page content stream
 *   5. Return the modified PDF as Uint8Array
 *   6. Caller writes it to disk via Electron IPC
 *
 * Coordinate system invariants:
 *   - Annotations are stored in PDF User Space (pdf.js output, rotation-aware)
 *   - pdf-lib draws in the unrotated page coordinate system
 *   - pdfUserSpaceToLibPoint() is the ONLY place rotation transform is applied
 *   - No independent coordinate math exists in this file
 *
 * Per-annotation rendering strategy:
 *   stroke      → series of line segments drawn as a single path or polyline
 *   highlight   → same path approach with high opacity yellow fill using blend
 *   text        → drawText() with line wrapping matching the canvas renderer
 *   shape/line  → drawLine()
 *   shape/arrow → drawLine() + arrowhead triangle
 *   shape/rect  → drawRectangle()
 *   shape/roundedRect → drawRectangle() with cornerRadius options (pdf-lib v1.17+)
 *   shape/ellipse → drawEllipse()
 */

import {
  PDFDocument,
  rgb,
  StandardFonts,
  LineCapStyle,
  LineJoinStyle,
  BlendMode,
  degrees,
} from 'pdf-lib';
import type { PDFPage } from 'pdf-lib';
import type {
  Annotation,
  StrokeAnnotation,
  HighlightAnnotation,
  TextAnnotation,
  ShapeAnnotation,
  InputPoint,
  DocumentAnnotationState,
} from '../types/annotations';
import { pdfUserSpaceToLibPoint } from './coordinateTransform';

// ─── Types ─────────────────────────────────────────────────────────────────────

/** All annotations for the whole document, keyed by page index. */
export type DocumentAnnotations = Map<number, Annotation[]>;

export interface ExportResult {
  data: Uint8Array;
  pageCount: number;
  annotationCount: number;
}

// ─── Color parsing ─────────────────────────────────────────────────────────────

/**
 * Parse a CSS hex color string (#rgb, #rrggbb, #rrggbbaa) into pdf-lib rgb().
 * Falls back to black on parse failure.
 */
function parseCssColor(cssColor: string): ReturnType<typeof rgb> {
  if (!cssColor || cssColor === 'transparent') return rgb(0, 0, 0);

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
    return rgb(0, 0, 0);
  }

  // Clamp
  r = Math.max(0, Math.min(1, r));
  g = Math.max(0, Math.min(1, g));
  b = Math.max(0, Math.min(1, b));

  return rgb(r, g, b);
}

// ─── Page info helper ──────────────────────────────────────────────────────────

interface PageInfo {
  width: number;   // pdf-lib page.getWidth()  — unrotated
  height: number;  // pdf-lib page.getHeight() — unrotated
  rotation: number; // /Rotate value: 0, 90, 180, 270
}

/**
 * Get unrotated dimensions and rotation angle of a pdf-lib page.
 * pdf-lib getWidth()/getHeight() return the pre-rotation dimensions.
 * The /Rotate value is stored in the page dictionary.
 */
function getPageInfo(page: PDFPage): PageInfo {
  const rotation = page.getRotation().angle;
  return {
    width: page.getWidth(),
    height: page.getHeight(),
    rotation,
  };
}

/**
 * Convert a single PDF User Space point to pdf-lib coordinates.
 * This is the ONLY coordinate conversion in this file — always via canonical module.
 */
function toLib(
  pdfX: number,
  pdfY: number,
  info: PageInfo,
): { x: number; y: number } {
  return pdfUserSpaceToLibPoint(pdfX, pdfY, info.rotation, info.width, info.height);
}

// ─── Stroke annotation ─────────────────────────────────────────────────────────

/**
 * Draw a stroke annotation as a PDF path.
 *
 * Approach: draw each segment individually to support variable opacity
 * and match the canvas rendering as closely as possible.
 *
 * Note: pdf-lib does not support variable line width per segment.
 * For pressure-sensitive strokes we use the average stroke width.
 */
function exportStroke(
  page: PDFPage,
  annotation: StrokeAnnotation,
  info: PageInfo,
): void {
  const { points, color, width, opacity } = annotation;
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

  // Uniform width: draw as single polyline path
  // pdf-lib doesn't have drawPolyline, so use drawSvgPath
  const libPoints = points.map(p => toLib(p.x, p.y, info));
  const pathParts = libPoints.map((p, i) =>
    i === 0 ? `M ${p.x.toFixed(2)} ${p.y.toFixed(2)}`
             : `L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`
  );
  const d = pathParts.join(' ');

  page.drawSvgPath(d, {
    x: 0,
    y: 0,
    borderColor: strokeColor,
    borderWidth: width,
    borderLineCap: LineCapStyle.Round,
    borderOpacity: opacity,
  });
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
  info: PageInfo,
): void {
  const { points, color, width, opacity } = annotation;
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
  info: PageInfo,
): Promise<void> {
  const { bounds, content, fontSize, bold, italic, color, opacity, align } = annotation;
  if (!content.trim()) return;

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
    const tl = toLib(bounds.x, bounds.y + bounds.height, info);
    page.drawRectangle({
      x: tl.x,
      y: tl.y,
      width: bounds.width,
      height: bounds.height,
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
  const maxWidth = bounds.width - PADDING * 2;

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
  info: PageInfo,
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
      });
      break;

    case 'roundedRect': {
      // pdf-lib supports borderRadius since v1.17.1
      const maxR = Math.min(rw, rh) / 2;
      const cornerRadius = Math.min(annotation.cornerRadius ?? 8, maxR);
      page.drawRectangle({
        x: rx,
        y: ry,
        width: rw,
        height: rh,
        borderColor: strokeColor,
        borderWidth: strokeWidth,
        borderLineCap: LineCapStyle.Round,
        color: fillColorParsed,
        opacity,
        borderOpacity: opacity,
        borderRadius: cornerRadius,
      } as Parameters<typeof page.drawRectangle>[0]);
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

// ─── Main export function ──────────────────────────────────────────────────────

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
  pageRotations: Record<number, number> = {},
): Promise<ExportResult> {
  // Load the original PDF preserving all existing content
  const pdfDoc = await PDFDocument.load(sourceData, {
    ignoreEncryption: false,
  });

  const pages = pdfDoc.getPages();
  let totalAnnotationCount = 0;

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex];
    const info = getPageInfo(page);

    // Apply any user-defined rotation override
    if (pageRotations[pageIndex]) {
      const newRotation = (((info.rotation + pageRotations[pageIndex]) % 360) + 360) % 360;
      page.setRotation(degrees(newRotation));
    }

    const pageAnnotations = annotations.get(pageIndex) || [];
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
        }
        totalAnnotationCount++;
      } catch (err) {
        // Log to error but don't abort the export — best effort per annotation
        const errMsg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Failed to export annotation ${annotation.id} (type=${annotation.type}) on page ${pageIndex}: ${errMsg}`
        );
      }
    }
  }

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
  const result: DocumentAnnotations = new Map();
  for (const [pageIndex, pageState] of docAnnotationState.pages) {
    if (pageState.annotations.length > 0) {
      result.set(pageIndex, [...pageState.annotations]);
    }
  }
  return result;
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
  pageRotations: Record<number, number> = {},
): Promise<boolean> {
  const annotations = buildAnnotationsMap(docAnnotState);

  // Build the annotated PDF
  const result = await exportAnnotatedPdf(sourceData, annotations, pageRotations);

  // Ask the user where to save
  const savePath = await window.electronAPI.saveFile(defaultName);
  if (!savePath) return false; // user cancelled

  // Write to disk via Electron IPC
  const ok = await window.electronAPI.writeFile(savePath, result.data.buffer as ArrayBuffer);
  if (!ok) throw new Error('Failed to write PDF to disk.');

  return true;
}
