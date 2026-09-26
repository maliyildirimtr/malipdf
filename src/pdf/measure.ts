/**
 * Measure tool maths: lengths and areas on the page, converted from PDF
 * points (1/72 inch of paper) to real-world units with a drawing scale.
 */
import type { MeasureAnnotation, MeasureCalibration, MeasureUnit, PdfPoint } from '../types/annotations';

/** Millimetres per unit. */
const MM: Record<MeasureUnit, number> = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8, pt: 25.4 / 72 };
const PT_TO_MM = 25.4 / 72;

export const MEASURE_UNITS: MeasureUnit[] = ['mm', 'cm', 'm', 'in', 'ft', 'pt'];

export function polylineLength(points: readonly PdfPoint[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return length;
}

/** Shoelace area of a polygon, in square points. */
export function polygonArea(points: readonly PdfPoint[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** Length in points → real units. */
export function realLength(pt: number, { scale, unit }: MeasureCalibration): number {
  return (pt * PT_TO_MM * scale) / MM[unit];
}

/** Area in square points → real square units. */
export function realArea(pt2: number, { scale, unit }: MeasureCalibration): number {
  return (pt2 * PT_TO_MM * PT_TO_MM * scale * scale) / (MM[unit] * MM[unit]);
}

export function formatNumber(value: number): string {
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return value.toFixed(digits);
}

/** The label shown next to a measurement, e.g. "12.5 cm" or "3.20 m²". */
export function measureLabel(annotation: Pick<MeasureAnnotation, 'kind' | 'points' | 'calibration'>): string {
  const { unit } = annotation.calibration;
  if (annotation.kind === 'area') {
    return `${formatNumber(realArea(polygonArea(annotation.points), annotation.calibration))} ${unit}²`;
  }
  return `${formatNumber(realLength(polylineLength(annotation.points), annotation.calibration))} ${unit}`;
}

/** Where the label sits: middle of the line, or the polygon's centroid. */
export function labelAnchor(annotation: Pick<MeasureAnnotation, 'kind' | 'points'>): PdfPoint {
  const pts = annotation.points;
  if (annotation.kind === 'distance' || pts.length < 3) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  let cx = 0, cy = 0, area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const cross = a.x * b.y - b.x * a.y;
    area += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  if (Math.abs(area) < 1e-9) {
    return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
  }
  return { x: cx / (3 * area), y: cy / (3 * area) };
}

/** End tick half-length, in points. */
export const MEASURE_TICK = 5;
/** Label font size, in points. */
export const MEASURE_FONT = 9;

/** Perpendicular end ticks for a distance line. */
export function measureTicks(a: PdfPoint, b: PdfPoint): [PdfPoint, PdfPoint][] {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nx = (-(b.y - a.y) / len) * MEASURE_TICK;
  const ny = ((b.x - a.x) / len) * MEASURE_TICK;
  return [a, b].map((p) => [{ x: p.x + nx, y: p.y + ny }, { x: p.x - nx, y: p.y - ny }] as [PdfPoint, PdfPoint]);
}
