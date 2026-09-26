/**
 * Ink to Shape: turns a hand-drawn stroke into a clean line, ellipse,
 * rectangle or polygon when it clearly is one (like OneNote's Ink to Shape).
 * Anything ambiguous stays ink. Pure geometry, works in any coordinate space.
 */
import type { PdfPoint } from '../types/annotations';

export type RecognizedShape =
  | { kind: 'line'; start: PdfPoint; end: PdfPoint }
  | { kind: 'ellipse'; x: number; y: number; width: number; height: number }
  | { kind: 'rectangle'; x: number; y: number; width: number; height: number }
  | { kind: 'polygon'; points: PdfPoint[] };

const dist = (a: PdfPoint, b: PdfPoint) => Math.hypot(a.x - b.x, a.y - b.y);

function distToSegment(p: PdfPoint, a: PdfPoint, b: PdfPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function rdp(points: PdfPoint[], tolerance: number): PdfPoint[] {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let best = -1;
    let index = -1;
    for (let i = s + 1; i < e; i++) {
      const d = distToSegment(points[i], points[s], points[e]);
      if (d > best) {
        best = d;
        index = i;
      }
    }
    if (best > tolerance) {
      keep[index] = 1;
      stack.push([s, index], [index, e]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Largest distance from any input point to the closed polygon's edges. */
function polygonFitError(points: readonly PdfPoint[], corners: readonly PdfPoint[]): number {
  let worst = 0;
  for (const p of points) {
    let best = Infinity;
    for (let i = 0; i < corners.length; i++) {
      best = Math.min(best, distToSegment(p, corners[i], corners[(i + 1) % corners.length]));
    }
    worst = Math.max(worst, best);
  }
  return worst;
}

export function recognizeShape(points: readonly PdfPoint[]): RecognizedShape | null {
  if (points.length < 2) return null;
  let length = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (i > 0) length += dist(points[i - 1], p);
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const width = maxX - minX;
  const height = maxY - minY;
  const diagonal = Math.hypot(width, height);
  if (diagonal < 12 || length < 12) return null; // dots and tiny marks stay ink

  const first = points[0];
  const last = points[points.length - 1];
  const gap = dist(first, last);

  // ── Straight line ──
  if (gap / length > 0.9) {
    const deviation = Math.max(...points.map((p) => distToSegment(p, first, last)));
    if (deviation <= Math.max(1.5, gap * 0.04)) return { kind: 'line', start: { ...first }, end: { ...last } };
    return null; // an open curve stays ink
  }

  // Everything else must be a closed loop.
  if (gap > Math.max(diagonal * 0.2, 6)) return null;

  // ── Ellipse / circle ──
  const cx = minX + width / 2;
  const cy = minY + height / 2;
  const rx = width / 2;
  const ry = height / 2;
  if (rx > 3 && ry > 3) {
    let sum = 0;
    let worst = 0;
    const angles = new Set<number>();
    for (const p of points) {
      const r = Math.hypot((p.x - cx) / rx, (p.y - cy) / ry);
      const error = Math.abs(r - 1);
      sum += error;
      worst = Math.max(worst, error);
      angles.add(Math.floor(((Math.atan2(p.y - cy, p.x - cx) + Math.PI) / (2 * Math.PI)) * 12));
    }
    if (sum / points.length < 0.09 && worst < 0.22 && angles.size >= 11) {
      return { kind: 'ellipse', x: minX, y: minY, width, height };
    }
  }

  // ── Polygon (triangle, rectangle, …) ──
  const loop = [...points, first];
  let corners = rdp(loop, diagonal * 0.07).slice(0, -1);
  // Merge corners that ended up almost on top of each other.
  corners = corners.filter((c, i) => i === 0 || dist(c, corners[i - 1]) > diagonal * 0.1);
  if (corners.length > 3 && dist(corners[0], corners[corners.length - 1]) < diagonal * 0.1) corners.pop();
  if (corners.length < 3 || corners.length > 6) return null;
  if (polygonFitError(points, corners) > diagonal * 0.09) return null;

  if (corners.length === 4) {
    const axisAligned = corners.every((c, i) => {
      const n = corners[(i + 1) % 4];
      const angle = Math.abs(Math.atan2(n.y - c.y, n.x - c.x)) % (Math.PI / 2);
      const off = Math.min(angle, Math.PI / 2 - angle);
      return off < (12 * Math.PI) / 180;
    });
    if (axisAligned) return { kind: 'rectangle', x: minX, y: minY, width, height };
  }
  return { kind: 'polygon', points: corners.map((c) => ({ x: c.x, y: c.y })) };
}
