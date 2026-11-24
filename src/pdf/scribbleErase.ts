/**
 * Scribble-to-Erase gesture detector.
 *
 * Recognizes a deliberate back-and-forth scribble drawn with the Pen over
 * existing ink/annotations so users can cross out a word to erase it naturally,
 * without ever false-triggering on normal cursive handwriting or shapes.
 */

import type { Annotation, InputPoint, PdfPoint, PdfRect } from '../types/annotations';
import { getAnnotationBounds } from './annotationGeometry';
import { hitTestAnnotation, isErasable } from './annotationHitTest';

interface PassSpan {
  start: { x: number; y: number };
  end: { x: number; y: number };
  length: number;
  dirX: number;
  dirY: number;
  points: { x: number; y: number }[];
}

/**
 * Returns true if the screen-space pen stroke looks like an intentional
 * back-and-forth scribble (e.g. scratching out a handwritten word).
 */
export function isScribbleGesture(screenPoints: readonly InputPoint[]): boolean {
  if (screenPoints.length < 8) return false;

  // 1. Resample out micro-jitter (< 6px steps)
  const pts: { x: number; y: number }[] = [{ x: screenPoints[0].x, y: screenPoints[0].y }];
  for (let i = 1; i < screenPoints.length; i++) {
    const prev = pts[pts.length - 1];
    const p = screenPoints[i];
    if (Math.hypot(p.x - prev.x, p.y - prev.y) >= 6) {
      pts.push({ x: p.x, y: p.y });
    }
  }
  const lastRaw = screenPoints[screenPoints.length - 1];
  const lastKept = pts[pts.length - 1];
  if (Math.hypot(lastRaw.x - lastKept.x, lastRaw.y - lastKept.y) >= 2) {
    pts.push({ x: lastRaw.x, y: lastRaw.y });
  }
  if (pts.length < 6) return false;

  // 2. Overall bounding box & path length
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let totalLen = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
    if (i > 0) {
      totalLen += Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y);
    }
  }
  const diag = Math.hypot(maxX - minX, maxY - minY);
  if (totalLen < 85 || diag < 18) return false;
  // Back-and-forth scribbling retraces the same zone, giving a high length/diag ratio.
  if (totalLen / diag < 2.15) return false;

  // 3. Segment the stroke into back-and-forth passes. Tracking the active pass
  // direction handles smooth/rounded U-turns as well as sharp zigzag corners.
  const passes: PassSpan[] = [];
  let passStartIdx = 0;
  let passLen = 0;
  let passDirX = 0;
  let passDirY = 0;
  let hasDir = false;

  const finalizePass = (endIdx: number) => {
    if (endIdx <= passStartIdx) return;
    const start = pts[passStartIdx];
    const end = pts[endIdx];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const net = Math.hypot(dx, dy);
    if (net >= 12) {
      passes.push({
        start,
        end,
        length: passLen,
        dirX: dx / net,
        dirY: dy / net,
        points: pts.slice(passStartIdx, endIdx + 1),
      });
    }
  };

  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const step = Math.hypot(dx, dy);
    if (step < 1e-4) continue;
    const ux = dx / step;
    const uy = dy / step;

    if (!hasDir) {
      passLen += step;
      const netDx = b.x - pts[passStartIdx].x;
      const netDy = b.y - pts[passStartIdx].y;
      const net = Math.hypot(netDx, netDy);
      if (net >= 12) {
        passDirX = netDx / net;
        passDirY = netDy / net;
        hasDir = true;
      }
      continue;
    }

    const dot = ux * passDirX + uy * passDirY;
    // Turned >= ~115° back against the current pass direction → reversal!
    if (dot <= -0.42) {
      finalizePass(i - 1);
      passStartIdx = i - 1;
      passLen = step;
      passDirX = ux;
      passDirY = uy;
      hasDir = true;
    } else {
      passLen += step;
      // Gently adapt passDir for slightly curved sweeps
      const netDx = b.x - pts[passStartIdx].x;
      const netDy = b.y - pts[passStartIdx].y;
      const net = Math.hypot(netDx, netDy);
      if (net >= 14) {
        passDirX = netDx / net;
        passDirY = netDy / net;
      }
    }
  }
  finalizePass(pts.length - 1);

  // Need at least 4 passes (3 direction reversals: -> <- -> <-)
  if (passes.length < 4) return false;

  // 4. Retrace overlap along the dominant axis of the longest pass.
  // Normal handwriting ("mmmm") moves steadily forward so non-adjacent passes
  // rarely overlap; a scribble crosses back over the same span repeatedly.
  let dominant = passes[0];
  for (const pass of passes) {
    if (pass.length > dominant.length) dominant = pass;
  }
  const ax = dominant.dirX;
  const ay = dominant.dirY;

  const intervals = passes.map((pass) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of pass.points) {
      const proj = p.x * ax + p.y * ay;
      if (proj < lo) lo = proj;
      if (proj > hi) hi = proj;
    }
    return { lo, hi, span: Math.max(1, hi - lo) };
  });

  const overlapRatio = (a: { lo: number; hi: number; span: number }, b: { lo: number; hi: number; span: number }) => {
    const ov = Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo);
    if (ov <= 0) return 0;
    return ov / Math.min(a.span, b.span);
  };

  let adjacentOverlaps = 0;
  for (let i = 0; i < intervals.length - 1; i++) {
    if (overlapRatio(intervals[i], intervals[i + 1]) >= 0.35) {
      adjacentOverlaps++;
    }
  }
  let skipOverlaps = 0;
  for (let i = 0; i < intervals.length - 2; i++) {
    if (overlapRatio(intervals[i], intervals[i + 2]) >= 0.25) {
      skipOverlaps++;
    }
  }

  return adjacentOverlaps >= 2 && skipOverlaps >= 1;
}

function boundsOverlap(a: PdfRect, b: PdfRect, pad: number): boolean {
  return (
    a.x - pad <= b.x + b.width
    && a.x + a.width + pad >= b.x
    && a.y - pad <= b.y + b.height
    && a.y + a.height + pad >= b.y
  );
}

/**
 * Finds all erasable annotations on the page actually intersected by the
 * scribble path (in PDF coordinates).
 */
export function findScribbleTargets(
  scribblePdfPoints: readonly PdfPoint[],
  annotations: readonly Annotation[],
  padPdf: number,
): Annotation[] {
  if (scribblePdfPoints.length < 2 || annotations.length === 0) return [];

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of scribblePdfPoints) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const scribbleBounds: PdfRect = {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };

  const pad = Math.max(6, padPdf);

  // Sample points along the scribble polyline at regular intervals for accurate hit testing
  const samples: PdfPoint[] = [scribblePdfPoints[0]];
  const stepSpacing = Math.max(4, pad * 0.75);
  for (let i = 1; i < scribblePdfPoints.length; i++) {
    const a = scribblePdfPoints[i - 1];
    const b = scribblePdfPoints[i];
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.min(24, Math.ceil(dist / stepSpacing)));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      samples.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }

  const hits: Annotation[] = [];
  for (const ann of annotations) {
    if (ann.locked || ann.hidden || !isErasable(ann)) continue;
    const annBounds = getAnnotationBounds(ann);
    if (!boundsOverlap(scribbleBounds, annBounds, pad)) continue;

    let touched = false;
    for (const pt of samples) {
      if (hitTestAnnotation(pt, ann, pad)) {
        touched = true;
        break;
      }
    }
    if (touched) hits.push(ann);
  }

  return hits;
}
