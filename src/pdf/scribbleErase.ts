/**
 * Scribble-to-Erase gesture detector (ultra-strict).
 *
 * Only triggers on a deliberate, energetic back-and-forth scratch-out directly
 * ON TOP of existing annotations — never on cursive handwriting, loops, or
 * writing right next to an existing word.
 */

import type { Annotation, InputPoint, PdfPoint, PdfRect } from '../types/annotations';
import { getAnnotationBounds } from './annotationGeometry';
import { hitTestAnnotation, isErasable } from './annotationHitTest';

interface PassSpan {
  start: { x: number; y: number };
  end: { x: number; y: number };
  length: number;
  net: number;
  dirX: number;
  dirY: number;
  points: { x: number; y: number }[];
}

/**
 * Returns true ONLY when the screen-space pen stroke is an unmistakable
 * deliberate back-and-forth scribble (≥ 5 linear passes / ≥ 4 sharp ~180°
 * reversals retracing the exact same span with high path density).
 */
export function isScribbleGesture(screenPoints: readonly InputPoint[]): boolean {
  if (screenPoints.length < 14) return false;

  // 1. Resample out micro-jitter (< 7px steps)
  const pts: { x: number; y: number }[] = [{ x: screenPoints[0].x, y: screenPoints[0].y }];
  for (let i = 1; i < screenPoints.length; i++) {
    const prev = pts[pts.length - 1];
    const p = screenPoints[i];
    if (Math.hypot(p.x - prev.x, p.y - prev.y) >= 7) {
      pts.push({ x: p.x, y: p.y });
    }
  }
  const lastRaw = screenPoints[screenPoints.length - 1];
  const lastKept = pts[pts.length - 1];
  if (Math.hypot(lastRaw.x - lastKept.x, lastRaw.y - lastKept.y) >= 2) {
    pts.push({ x: lastRaw.x, y: lastRaw.y });
  }
  if (pts.length < 10) return false;

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
  // Require substantial scratch-out travel & high retrace density (≥ 3.1x diagonal)
  if (totalLen < 160 || diag < 26) return false;
  if (totalLen / diag < 3.1) return false;

  // 3. Segment the stroke into sharp back-and-forth passes (>= 130° reversals)
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
    if (net >= 18) {
      passes.push({
        start,
        end,
        length: passLen,
        net,
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
      if (net >= 16) {
        passDirX = netDx / net;
        passDirY = netDy / net;
        hasDir = true;
      }
      continue;
    }

    const dot = ux * passDirX + uy * passDirY;
    // Sharp reversal >= ~130° against current pass direction
    if (dot <= -0.64) {
      finalizePass(i - 1);
      passStartIdx = i - 1;
      passLen = step;
      passDirX = ux;
      passDirY = uy;
      hasDir = true;
    } else {
      passLen += step;
      const netDx = b.x - pts[passStartIdx].x;
      const netDy = b.y - pts[passStartIdx].y;
      const net = Math.hypot(netDx, netDy);
      if (net >= 18) {
        passDirX = netDx / net;
        passDirY = netDy / net;
      }
    }
  }
  finalizePass(pts.length - 1);

  // Need at least 5 deliberate passes (4 sharp back-and-forth reversals: -> <- -> <- ->)
  if (passes.length < 5) return false;

  // 4. Passes in a scratch-out are mostly straight (not round cursive loops like 'e','o','8')
  const straightPasses = passes.filter((p) => p.net / Math.max(1, p.length) >= 0.72);
  if (straightPasses.length < 4) return false;

  // 5. Retrace overlap along the dominant axis of the longest pass
  let dominant = passes[0];
  for (const pass of passes) {
    if (pass.net > dominant.net) dominant = pass;
  }
  const ax = dominant.dirX;
  const ay = dominant.dirY;

  // Opposite-direction alignment: consecutive passes must run roughly parallel/antiparallel
  let alignedPasses = 0;
  for (const pass of passes) {
    if (Math.abs(pass.dirX * ax + pass.dirY * ay) >= 0.72) {
      alignedPasses++;
    }
  }
  if (alignedPasses < 4) return false;

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
    if (overlapRatio(intervals[i], intervals[i + 1]) >= 0.55) {
      adjacentOverlaps++;
    }
  }
  let skipOverlaps = 0;
  for (let i = 0; i < intervals.length - 2; i++) {
    if (overlapRatio(intervals[i], intervals[i + 2]) >= 0.45) {
      skipOverlaps++;
    }
  }

  return adjacentOverlaps >= 3 && skipOverlaps >= 2;
}

function rectIntersectionArea(a: PdfRect, b: PdfRect): number {
  const ox = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const oy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return ox * oy;
}

/**
 * Finds annotations genuinely scribbled OVER (not merely brushed at the edge).
 * Requires tight contact + multiple scribble crossings so writing right next to
 * an existing word NEVER accidentally erases the neighbor.
 */
export function findScribbleTargets(
  scribblePdfPoints: readonly PdfPoint[],
  annotations: readonly Annotation[],
  padPdf: number,
): Annotation[] {
  if (scribblePdfPoints.length < 4 || annotations.length === 0) return [];

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

  // Tight touch tolerance (never reach across gaps into neighboring words)
  const pad = Math.max(2, Math.min(5, padPdf));

  // Sample points along the scribble polyline with index tracking so we can
  // verify multiple distinct crossings rather than a single edge graze.
  const samples: PdfPoint[] = [scribblePdfPoints[0]];
  const stepSpacing = 4;
  for (let i = 1; i < scribblePdfPoints.length; i++) {
    const a = scribblePdfPoints[i - 1];
    const b = scribblePdfPoints[i];
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.min(20, Math.ceil(dist / stepSpacing)));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      samples.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }

  const hits: Annotation[] = [];
  for (const ann of annotations) {
    // Only scribble-erase ink/shapes/text (never accidentally delete a photo!)
    if (ann.locked || ann.hidden || !isErasable(ann) || ann.type === 'image') continue;
    const annBounds = getAnnotationBounds(ann);
    const interArea = rectIntersectionArea(scribbleBounds, annBounds);
    if (interArea <= 0) continue;

    // Count distinct crossing clusters along the scribble (separated by >= 2 non-hitting samples)
    let hitCount = 0;
    let crossingClusters = 0;
    let inCluster = false;
    let gap = 0;
    for (const pt of samples) {
      if (hitTestAnnotation(pt, ann, pad)) {
        hitCount++;
        if (!inCluster) {
          crossingClusters++;
          inCluster = true;
        }
        gap = 0;
      } else if (inCluster) {
        gap++;
        if (gap >= 2) inCluster = false;
      }
    }

    // Require either >= 2 distinct scribble passes crossing the annotation, OR
    // substantial coverage inside the scribble box (>= 35% of the annotation's bbox).
    const annArea = Math.max(1, annBounds.width * annBounds.height);
    const coverage = interArea / annArea;
    if (crossingClusters >= 2 || (hitCount >= 4 && coverage >= 0.35)) {
      hits.push(ann);
    }
  }

  return hits;
}
