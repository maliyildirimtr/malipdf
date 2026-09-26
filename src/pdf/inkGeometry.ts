/**
 * Ink geometry shared by the live preview, the on-screen renderer and the PDF
 * exporter, so a stroke looks the same while drawing, after pen-up and in the
 * saved file.
 *
 * - Smooth strokes: quadratic curves through the midpoints of the input
 *   points (stable while drawing: only the last piece changes). Emitted as
 *   cubic Béziers so canvas and PDF draw exactly the same curve.
 * - Pressure strokes: a filled outline (variable width) instead of many short
 *   overlapping segments, so there are no dark "beads" and no width steps.
 * - Dots: a one-point stroke is a filled circle.
 *
 * All functions are pure and coordinate-space agnostic (PDF points or CSS px).
 */
import type { InputPoint } from '../types/annotations';

export type PathCommand =
  | { op: 'M'; x: number; y: number }
  | { op: 'L'; x: number; y: number }
  | { op: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { op: 'Z' };

export interface InkShape {
  /** 'stroke' → stroke the path with the given width; 'fill' → fill it. */
  mode: 'stroke' | 'fill';
  commands: PathCommand[];
}

type XY = { x: number; y: number };

/** Same width formula as before, so existing files keep their look. */
export function pressureWidth(baseWidth: number, pressure: number): number {
  return baseWidth * (0.3 + pressure * 1.4);
}

export function hasRealPressure(points: readonly InputPoint[]): boolean {
  return points.some((p) => p.pressure !== 0.5);
}

// ─── Path building ───────────────────────────────────────────────────────────

/** Quadratic (from, control, to) as an exact cubic. */
function quadToCubic(from: XY, control: XY, to: XY): PathCommand {
  return {
    op: 'C',
    x1: from.x + (2 / 3) * (control.x - from.x),
    y1: from.y + (2 / 3) * (control.y - from.y),
    x2: to.x + (2 / 3) * (control.x - to.x),
    y2: to.y + (2 / 3) * (control.y - to.y),
    x: to.x,
    y: to.y,
  };
}

/** Centre line of a stroke (one or more points). */
export function centerlinePath(points: readonly XY[], smooth: boolean): PathCommand[] {
  if (points.length === 0) return [];
  const commands: PathCommand[] = [{ op: 'M', x: points[0].x, y: points[0].y }];
  if (points.length === 1) return commands;
  if (!smooth || points.length < 3) {
    for (let i = 1; i < points.length; i++) commands.push({ op: 'L', x: points[i].x, y: points[i].y });
    return commands;
  }
  let current: XY = points[0];
  const firstMid = mid(points[0], points[1]);
  commands.push({ op: 'L', x: firstMid.x, y: firstMid.y });
  current = firstMid;
  for (let i = 1; i < points.length - 1; i++) {
    const next = mid(points[i], points[i + 1]);
    commands.push(quadToCubic(current, points[i], next));
    current = next;
  }
  const last = points[points.length - 1];
  commands.push({ op: 'L', x: last.x, y: last.y });
  return commands;
}

/** A circle as four cubic Béziers (used for dots). */
export function circlePath(cx: number, cy: number, r: number): PathCommand[] {
  const k = 0.5522847498 * r;
  return [
    { op: 'M', x: cx + r, y: cy },
    { op: 'C', x1: cx + r, y1: cy + k, x2: cx + k, y2: cy + r, x: cx, y: cy + r },
    { op: 'C', x1: cx - k, y1: cy + r, x2: cx - r, y2: cy + k, x: cx - r, y: cy },
    { op: 'C', x1: cx - r, y1: cy - k, x2: cx - k, y2: cy - r, x: cx, y: cy - r },
    { op: 'C', x1: cx + k, y1: cy - r, x2: cx + r, y2: cy - k, x: cx + r, y: cy },
    { op: 'Z' },
  ];
}

function mid(a: XY, b: XY): XY {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Points along the smoothed centre line (for the pressure outline). */
function sampleSmoothed(points: readonly InputPoint[], smooth: boolean): InputPoint[] {
  if (!smooth || points.length < 3) return [...points];
  const out: InputPoint[] = [points[0]];
  let from: InputPoint = { ...mid(points[0], points[1]), pressure: (points[0].pressure + points[1].pressure) / 2, timestamp: 0 };
  out.push(from);
  for (let i = 1; i < points.length - 1; i++) {
    const control = points[i];
    const to: InputPoint = { ...mid(points[i], points[i + 1]), pressure: (points[i].pressure + points[i + 1].pressure) / 2, timestamp: 0 };
    const length = Math.hypot(control.x - from.x, control.y - from.y) + Math.hypot(to.x - control.x, to.y - control.y);
    const steps = Math.max(1, Math.min(12, Math.ceil(length / 2)));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const a = (1 - t) * (1 - t);
      const b = 2 * (1 - t) * t;
      const c = t * t;
      out.push({
        x: a * from.x + b * control.x + c * to.x,
        y: a * from.y + b * control.y + c * to.y,
        pressure: a * from.pressure + b * control.pressure + c * to.pressure,
        timestamp: 0,
      });
    }
    from = to;
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * Filled outline of a variable-width stroke: left side forward, round end
 * cap, right side backward, round start cap.
 */
export function pressureOutline(points: readonly InputPoint[], baseWidth: number, smooth: boolean): PathCommand[] {
  const samples = sampleSmoothed(points, smooth).filter(
    (p, i, all) => i === 0 || Math.hypot(p.x - all[i - 1].x, p.y - all[i - 1].y) > 1e-6,
  );
  if (samples.length === 0) return [];
  // Light smoothing of the width so pressure noise does not show as wobble.
  const radii: number[] = [];
  let r = pressureWidth(baseWidth, samples[0].pressure) / 2;
  for (const p of samples) {
    r = r * 0.6 + (pressureWidth(baseWidth, p.pressure) / 2) * 0.4;
    radii.push(Math.max(r, baseWidth * 0.05));
  }
  if (samples.length === 1) return circlePath(samples[0].x, samples[0].y, radii[0]);

  const left: XY[] = [];
  const right: XY[] = [];
  for (let i = 0; i < samples.length; i++) {
    const a = samples[Math.max(0, i - 1)];
    const b = samples[Math.min(samples.length - 1, i + 1)];
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    const length = Math.hypot(dx, dy) || 1;
    dx /= length;
    dy /= length;
    left.push({ x: samples[i].x - dy * radii[i], y: samples[i].y + dx * radii[i] });
    right.push({ x: samples[i].x + dy * radii[i], y: samples[i].y - dx * radii[i] });
  }

  const commands: PathCommand[] = [{ op: 'M', x: left[0].x, y: left[0].y }];
  for (let i = 1; i < left.length; i++) commands.push({ op: 'L', x: left[i].x, y: left[i].y });
  appendCap(commands, samples[samples.length - 1], samples[samples.length - 2], radii[radii.length - 1]);
  for (let i = right.length - 1; i >= 0; i--) commands.push({ op: 'L', x: right[i].x, y: right[i].y });
  appendCap(commands, samples[0], samples[1], radii[0]);
  commands.push({ op: 'Z' });
  return commands;
}

/** Half circle around `end`, pointing away from `before`. */
function appendCap(commands: PathCommand[], end: XY, before: XY, radius: number): void {
  const angle = Math.atan2(end.y - before.y, end.x - before.x);
  const steps = 8;
  for (let s = 1; s < steps; s++) {
    const a = angle + Math.PI / 2 - (Math.PI * s) / steps;
    commands.push({ op: 'L', x: end.x + Math.cos(a) * radius, y: end.y + Math.sin(a) * radius });
  }
}

/** Geometry for a pen stroke. */
export function penShape(points: readonly InputPoint[], width: number, smooth: boolean, usePressure: boolean): InkShape {
  if (points.length === 1) return { mode: 'fill', commands: circlePath(points[0].x, points[0].y, width / 2) };
  if (usePressure && hasRealPressure(points)) return { mode: 'fill', commands: pressureOutline(points, width, smooth) };
  return { mode: 'stroke', commands: centerlinePath(points, smooth) };
}

/** Geometry for a highlighter stroke (always smoothed, fixed width). */
export function highlightShape(points: readonly InputPoint[]): InkShape {
  return { mode: 'stroke', commands: centerlinePath(points, true) };
}

// ─── Canvas output ───────────────────────────────────────────────────────────

export function commandsToPath2D(commands: readonly PathCommand[]): Path2D {
  const path = new Path2D();
  for (const c of commands) {
    if (c.op === 'M') path.moveTo(c.x, c.y);
    else if (c.op === 'L') path.lineTo(c.x, c.y);
    else if (c.op === 'C') path.bezierCurveTo(c.x1, c.y1, c.x2, c.y2, c.x, c.y);
    else path.closePath();
  }
  return path;
}

// ─── Simplification ──────────────────────────────────────────────────────────

/**
 * Drop points that add nothing visible: near-duplicates, then
 * Ramer–Douglas–Peucker. Pressure counts as a third dimension (scaled to the
 * width change it causes) so pressure changes are kept.
 */
export function simplifyInkPoints(
  points: readonly InputPoint[],
  tolerance: number,
  pressureScale = 0,
): InputPoint[] {
  if (points.length <= 2 || !(tolerance > 0)) return [...points];
  const deduped: InputPoint[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const last = deduped[deduped.length - 1];
    const p = points[i];
    const moved = Math.hypot(p.x - last.x, p.y - last.y);
    const pressed = Math.abs(p.pressure - last.pressure) * pressureScale;
    if (moved >= tolerance * 0.5 || pressed >= tolerance || i === points.length - 1) deduped.push(p);
  }
  if (deduped.length <= 2) return deduped;

  const keep = new Uint8Array(deduped.length);
  keep[0] = 1;
  keep[deduped.length - 1] = 1;
  const stack: [number, number][] = [[0, deduped.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    let maxDistance = -1;
    let index = -1;
    const a = deduped[start];
    const b = deduped[end];
    for (let i = start + 1; i < end; i++) {
      const d = distance3(deduped[i], a, b, pressureScale);
      if (d > maxDistance) {
        maxDistance = d;
        index = i;
      }
    }
    if (maxDistance > tolerance && index > 0) {
      keep[index] = 1;
      stack.push([start, index], [index, end]);
    }
  }
  return deduped.filter((_, i) => keep[i] === 1);
}

function distance3(p: InputPoint, a: InputPoint, b: InputPoint, k: number): number {
  const ax = a.x, ay = a.y, az = a.pressure * k;
  const vx = b.x - ax, vy = b.y - ay, vz = b.pressure * k - az;
  const wx = p.x - ax, wy = p.y - ay, wz = p.pressure * k - az;
  const lengthSq = vx * vx + vy * vy + vz * vz;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy + wz * vz) / lengthSq));
  return Math.hypot(wx - t * vx, wy - t * vy, wz - t * vz);
}
