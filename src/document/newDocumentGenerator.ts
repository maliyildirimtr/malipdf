import { PDFDocument, PDFPage, rgb, setGraphicsState } from 'pdf-lib';
import { convertToPt } from './pageSizes';
import { drawNoteTemplate, type NoteTemplateId } from './noteTemplates';

export type BackgroundSpacing = 5 | 8 | 10;
export type BackgroundWeight = 'light' | 'normal' | 'strong';

export type PageBackground =
  | { type: 'blank' }
  | {
      type: 'grid' | 'lined' | 'dotted';
      spacingMm: BackgroundSpacing;
      color: string;
      opacity: number;
      weight: BackgroundWeight;
    }
  | { type: 'template'; template: NoteTemplateId; spacingMm: BackgroundSpacing; color: string }
  | {
      type: 'millimetric';
      majorSpacingMm: BackgroundSpacing;
      color: string;
      minorOpacity: number;
      majorOpacity: number;
      minorWeight: BackgroundWeight;
      majorWeight: BackgroundWeight;
    };

export interface NewDocumentSpec {
  widthPt: number;
  heightPt: number;
  background: PageBackground;
  pageCount: number;
}

function getWeightThickness(weight: BackgroundWeight): number {
  switch (weight) {
    case 'light': return 0.25;
    case 'normal': return 0.5;
    case 'strong': return 1.0;
  }
}

function hexToPdfRgb(hex: string) {
  // Simple hex string parsing #RRGGBB
  if (hex.startsWith('#')) hex = hex.slice(1);
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  return rgb(r, g, b);
}

function estimateComplexity(spec: NewDocumentSpec): number {
  if (spec.background.type === 'blank') return 0;

  const { widthPt, heightPt, pageCount } = spec;
  let linesPerPage = 0;

  if (spec.background.type === 'grid' || spec.background.type === 'lined' || spec.background.type === 'dotted') {
    const spacingPt = convertToPt(spec.background.spacingMm, 'mm');
    const hLines = Math.floor(heightPt / spacingPt);
    const vLines = spec.background.type === 'lined' ? 0 : Math.floor(widthPt / spacingPt);
    
    if (spec.background.type === 'dotted') {
      linesPerPage = hLines * vLines; // Dots count
    } else {
      linesPerPage = hLines + vLines;
    }
  } else if (spec.background.type === 'template') {
    linesPerPage = 200;
  } else if (spec.background.type === 'millimetric') {
    const minorPt = convertToPt(1, 'mm');
    linesPerPage = Math.floor(heightPt / minorPt) + Math.floor(widthPt / minorPt);
  }

  return pageCount * linesPerPage;
}

function drawGridBackground(page: PDFPage, width: number, height: number, spacingMm: number, colorHex: string, opacity: number, weight: BackgroundWeight) {
  const spacingPt = convertToPt(spacingMm, 'mm');
  const thickness = getWeightThickness(weight);
  const color = hexToPdfRgb(colorHex);

  for (let x = spacingPt; x < width; x += spacingPt) {
    page.drawLine({ start: { x, y: 0 }, end: { x, y: height }, thickness, color, opacity });
  }
  for (let y = spacingPt; y < height; y += spacingPt) {
    page.drawLine({ start: { x: 0, y }, end: { x: width, y }, thickness, color, opacity });
  }
}

function drawLinedBackground(page: PDFPage, width: number, height: number, spacingMm: number, colorHex: string, opacity: number, weight: BackgroundWeight) {
  const spacingPt = convertToPt(spacingMm, 'mm');
  const thickness = getWeightThickness(weight);
  const color = hexToPdfRgb(colorHex);

  for (let y = spacingPt; y < height; y += spacingPt) {
    page.drawLine({ start: { x: 0, y }, end: { x: width, y }, thickness, color, opacity });
  }
}

function drawDottedBackground(page: PDFPage, width: number, height: number, spacingMm: number, colorHex: string, opacity: number, weight: BackgroundWeight) {
  const spacingPt = convertToPt(spacingMm, 'mm');
  // Use path definition instead of individual drawCircle calls to avoid thousands of discrete operations overhead
  // A dot in PDF can be a tiny circle or just a zero-length line with a round cap.
  const radius = getWeightThickness(weight);
  const color = hexToPdfRgb(colorHex);

  let pathStr = '';
  for (let x = spacingPt; x < width; x += spacingPt) {
    for (let y = spacingPt; y < height; y += spacingPt) {
      // Small circle approximation using moveTo/lineTo (or rect if faster). For simplicity, let's just do a tiny square or line
      pathStr += `M ${x.toFixed(2)} ${y.toFixed(2)} l 0.01 0 `;
    }
  }

  // Draw SVG path using round caps
  page.drawSvgPath(pathStr, {
    color: undefined, // no fill
    borderColor: color,
    borderWidth: radius * 2,
    borderOpacity: opacity,
    // Add borderLineCap: 'Round' in production if needed, or stick to small segments
  });
}

function drawMillimetricBackground(page: PDFPage, width: number, height: number, majorSpacingMm: number, colorHex: string, minorOpacity: number, majorOpacity: number, minorWeight: BackgroundWeight, majorWeight: BackgroundWeight) {
  const minorPt = convertToPt(1, 'mm');
  const color = hexToPdfRgb(colorHex);
  const minorThickness = getWeightThickness(minorWeight);
  const majorThickness = getWeightThickness(majorWeight);

  const maxIndexX = Math.floor(width / minorPt);
  const maxIndexY = Math.floor(height / minorPt);

  // We do two passes or one pass. Two passes groups opacity calls better if drawing directly.
  for (let idx = 1; idx <= maxIndexX; idx++) {
    const isMajor = idx % majorSpacingMm === 0;
    const x = idx * minorPt;
    page.drawLine({
      start: { x, y: 0 },
      end: { x, y: height },
      thickness: isMajor ? majorThickness : minorThickness,
      color,
      opacity: isMajor ? majorOpacity : minorOpacity
    });
  }

  for (let idx = 1; idx <= maxIndexY; idx++) {
    const isMajor = idx % majorSpacingMm === 0;
    const y = idx * minorPt;
    page.drawLine({
      start: { x: 0, y },
      end: { x: width, y },
      thickness: isMajor ? majorThickness : minorThickness,
      color,
      opacity: isMajor ? majorOpacity : minorOpacity
    });
  }
}

/** Default background of the given kind, as the New Document dialog makes it. */
export function makePageBackground(type: Exclude<PageBackground['type'], 'template'>, spacingMm: BackgroundSpacing, color = '#999999'): PageBackground {
  if (type === 'blank') return { type: 'blank' };
  if (type === 'millimetric') {
    return { type: 'millimetric', majorSpacingMm: spacingMm, color, minorOpacity: 0.4, majorOpacity: 1, minorWeight: 'light', majorWeight: 'normal' };
  }
  return { type, spacingMm, color, opacity: 1, weight: 'normal' };
}

/** Draw `background` over the whole (unrotated) page. */
export function drawPageBackground(page: PDFPage, width: number, height: number, background: PageBackground): void {
  if (background.type === 'grid') {
    drawGridBackground(page, width, height, background.spacingMm, background.color, background.opacity, background.weight);
  } else if (background.type === 'lined') {
    drawLinedBackground(page, width, height, background.spacingMm, background.color, background.opacity, background.weight);
  } else if (background.type === 'dotted') {
    drawDottedBackground(page, width, height, background.spacingMm, background.color, background.opacity, background.weight);
  } else if (background.type === 'template') {
    drawNoteTemplate(page, width, height, background.template, background.spacingMm, background.color);
  } else if (background.type === 'millimetric') {
    drawMillimetricBackground(page, width, height, background.majorSpacingMm, background.color, background.minorOpacity, background.majorOpacity, background.minorWeight, background.majorWeight);
  }
}

export async function generateNewDocument(spec: NewDocumentSpec): Promise<Uint8Array> {
  const complexity = estimateComplexity(spec);
  // Complexity safety guard: If over 1,000,000 operations, throw an error to prevent freezing
  // E.g., 500 pages of A0 millimetric is (1189 + 841) * 500 = 1,015,000 operations
  if (complexity > 500000) {
    throw new Error('Background complexity too high. Please reduce page count or increase grid spacing.');
  }

  const doc = await PDFDocument.create();
  const { widthPt, heightPt, background, pageCount } = spec;

  for (let i = 0; i < Math.max(1, pageCount); i++) {
    const page = doc.addPage([widthPt, heightPt]);

    drawPageBackground(page, widthPt, heightPt, background);
  }

  return await doc.save();
}
