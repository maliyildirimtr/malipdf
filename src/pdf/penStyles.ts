/**
 * Pen styles (pen nib types) and pen tilt.
 *
 * - ballpoint: the classic MaliPDF pen (inkGeometry.penShape, unchanged).
 * - fountain: pressure + speed (fast strokes are thinner), tapered ends.
 * - calligraphy: a flat nib held at 40°: thick across, hairline along.
 * - pencil: thin and a little transparent; tilting the pen shades wider.
 * - marker: even, broad line; tilt widens it.
 *
 * Shapes are computed in PDF space (y up), so the screen and the saved PDF
 * draw the same outline; the renderer maps the commands to the screen.
 */
import type { InputPoint, PenStyle } from '../types/annotations';
import { buildCapsuleOutline, circlePath, hasRealPressure, penShape, type InkShape, type PathCommand } from './inkGeometry';

export const PEN_STYLES: { value: PenStyle; label: string }[] = [
  { value: 'ballpoint', label: 'Ballpoint' },
  { value: 'fountain', label: 'Fountain pen' },
  { value: 'calligraphy', label: 'Calligraphy' },
  { value: 'pencil', label: 'Pencil' },
  { value: 'marker', label: 'Marker' },
];

/** Extra transparency of a style (multiplied with the stroke's opacity). */
export function penStyleOpacity(style: PenStyle | undefined): number {
  return style === 'pencil' ? 0.82 : 1;
}

/** How far the pen leans: 0 upright … 1 lying flat (from PointerEvent tilt data). */
export function pointerTilt(event: { pointerType?: string; altitudeAngle?: number; tiltX?: number; tiltY?: number }): number | undefined {
  if (event.pointerType !== 'pen') return undefined;
  let altitude: number | undefined;
  if (typeof event.altitudeAngle === 'number' && Number.isFinite(event.altitudeAngle)) altitude = event.altitudeAngle;
  else if (typeof event.tiltX === 'number' && typeof event.tiltY === 'number' && (event.tiltX !== 0 || event.tiltY !== 0)) {
    const tx = Math.tan((event.tiltX * Math.PI) / 180);
    const ty = Math.tan((event.tiltY * Math.PI) / 180);
    altitude = Math.atan(1 / Math.max(1e-6, Math.hypot(tx, ty)));
  }
  if (altitude === undefined) return undefined;
  // Upright (90°) → 0; 30° above the paper or lower → 1.
  const tilt = Math.max(0, Math.min(1, (Math.PI / 2 - altitude) / (Math.PI / 3)));
  return tilt < 0.02 ? undefined : Math.round(tilt * 100) / 100;
}

type Sample = InputPoint & { tilt: number };

/** Points along the (optionally smoothed) centre line, with pressure, tilt and time interpolated. */
function samples(points: readonly InputPoint[], smooth: boolean): Sample[] {
  const base = points.map((p) => ({ ...p, tilt: p.tilt ?? 0 }));
  if (!smooth || base.length < 3) return base;
  const mix = (a: Sample, b: Sample, t: number): Sample => ({
    x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t,
    pressure: a.pressure + (b.pressure - a.pressure) * t,
    tilt: a.tilt + (b.tilt - a.tilt) * t,
    timestamp: a.timestamp + (b.timestamp - a.timestamp) * t,
  });
  const out: Sample[] = [base[0]];
  let from = mix(base[0], base[1], 0.5);
  out.push(from);
  for (let i = 1; i < base.length - 1; i++) {
    const control = base[i];
    const to = mix(base[i], base[i + 1], 0.5);
    const length = Math.hypot(control.x - from.x, control.y - from.y) + Math.hypot(to.x - control.x, to.y - control.y);
    const steps = Math.max(1, Math.min(12, Math.ceil(length / 1.5)));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const p = mix(mix(from, control, t), mix(control, to, t), t);
      out.push(p);
    }
    from = to;
  }
  out.push(base[base.length - 1]);
  return out.filter((p, i, all) => i === 0 || Math.hypot(p.x - all[i - 1].x, p.y - all[i - 1].y) > 1e-6);
}

/** Half-width of the line at each sample, for the round-nib styles. */
function radii(style: PenStyle, s: readonly Sample[], width: number, usePressure: boolean): number[] {
  const pressure = usePressure && hasRealPressure(s);
  const half = width / 2;
  // Distance along the stroke, for tapering the ends.
  const along: number[] = [0];
  for (let i = 1; i < s.length; i++) along.push(along[i - 1] + Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y));
  const total = along[along.length - 1] || 1;
  const out: number[] = [];
  let smoothed = 0;
  for (let i = 0; i < s.length; i++) {
    const p = s[i];
    const pr = pressure ? (Number.isFinite(p.pressure) ? Math.max(0, Math.min(1, p.pressure)) : 0.5) : 0.5;
    const tilt = Number.isFinite(p.tilt) ? Math.max(0, Math.min(1, p.tilt)) : 0;
    let r: number;
    if (style === 'fountain') {
      const prev = s[Math.max(0, i - 1)];
      const dt = Math.max(1, p.timestamp - prev.timestamp);
      const speed = i === 0 ? 0 : Math.hypot(p.x - prev.x, p.y - prev.y) / dt; // pt per ms
      const speedFactor = Math.max(0.5, Math.min(1.15, 1.15 - speed * 0.35));
      const taperLength = Math.min(total * 0.18, width * 6);
      const taper = Math.min(1, 0.3 + 0.7 * Math.min(along[i], total - along[i]) / Math.max(1e-6, taperLength));
      r = half * (0.25 + pr * 1.5) * speedFactor * taper * (1 + tilt * 0.6);
    } else if (style === 'pencil') {
      r = half * (0.55 + pr * 0.7) * (1 + tilt * 2.2);
    } else { // marker
      r = half * (1 + tilt * 1.2);
    }
    smoothed = i === 0 ? r : smoothed * 0.55 + r * 0.45;
    out.push(Math.max(smoothed, width * 0.04));
  }
  return out;
}

/** Calligraphy: the flat nib (in PDF space, y up) leans 40° like "/". */
const NIB_ANGLE = (40 * Math.PI) / 180;

function calligraphyOutline(s: readonly Sample[], width: number, usePressure: boolean): PathCommand[] {
  const pressure = usePressure && hasRealPressure(s);
  const nib = { x: Math.cos(NIB_ANGLE), y: Math.sin(NIB_ANGLE) };
  const thin = width * 0.06; // the hairline never vanishes
  const commands: PathCommand[] = [];

  // Emit each segment as a positively-oriented (CCW) quad so direction reversals
  // along cursive hairpins never invert winding and punch white holes in ink.
  const pushCCWQuad = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }, d: { x: number; y: number }) => {
    const area2 =
      (a.x * b.y - b.x * a.y) +
      (b.x * c.y - c.x * b.y) +
      (c.x * d.y - d.x * c.y) +
      (d.x * a.y - a.x * d.y);
    if (Math.abs(area2) < 1e-8) return;
    if (area2 > 0) {
      commands.push({ op: 'M', x: a.x, y: a.y }, { op: 'L', x: b.x, y: b.y }, { op: 'L', x: c.x, y: c.y }, { op: 'L', x: d.x, y: d.y }, { op: 'Z' });
    } else {
      commands.push({ op: 'M', x: a.x, y: a.y }, { op: 'L', x: d.x, y: d.y }, { op: 'L', x: c.x, y: c.y }, { op: 'L', x: b.x, y: b.y }, { op: 'Z' });
    }
  };

  for (let i = 0; i < s.length - 1; i++) {
    const p0 = s[i];
    const p1 = s[i + 1];
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-5) continue;
    const nx = (-dy / len) * thin;
    const ny = (dx / len) * thin;
    const pr0 = Number.isFinite(p0.pressure) ? Math.max(0, Math.min(1, p0.pressure)) : 0.5;
    const pr1 = Number.isFinite(p1.pressure) ? Math.max(0, Math.min(1, p1.pressure)) : 0.5;
    const h0 = width * 0.85 * (pressure ? 0.45 + pr0 : 1);
    const h1 = width * 0.85 * (pressure ? 0.45 + pr1 : 1);
    const l0 = { x: p0.x + nib.x * h0 + nx, y: p0.y + nib.y * h0 + ny };
    const r0 = { x: p0.x - nib.x * h0 - nx, y: p0.y - nib.y * h0 - ny };
    const l1 = { x: p1.x + nib.x * h1 + nx, y: p1.y + nib.y * h1 + ny };
    const r1 = { x: p1.x - nib.x * h1 - nx, y: p1.y - nib.y * h1 - ny };
    pushCCWQuad(l0, r0, r1, l1);
  }
  if (commands.length === 0 && s.length > 0) {
    const p = s[0];
    const h = width * 0.85;
    const nx = nib.x * h;
    const ny = nib.y * h;
    const t = width * 0.12;
    pushCCWQuad(
      { x: p.x + nx - t, y: p.y + ny + t },
      { x: p.x + nx + t, y: p.y + ny - t },
      { x: p.x - nx + t, y: p.y - ny - t },
      { x: p.x - nx - t, y: p.y - ny + t },
    );
  }
  return commands;
}

/** Geometry of a pen stroke in the given style (PDF space; width in points). */
export function styledPenShape(points: readonly InputPoint[], width: number, smooth: boolean, usePressure: boolean, style: PenStyle | undefined): InkShape {
  if (!style || style === 'ballpoint') return penShape(points, width, smooth, usePressure);
  if (points.length === 0) return { mode: 'fill', commands: [] };
  const s = samples(points, smooth);
  if (style === 'calligraphy') {
    if (s.length === 1) {
      const h = width * 0.85;
      const nib = { x: Math.cos(NIB_ANGLE) * h, y: Math.sin(NIB_ANGLE) * h };
      const p = s[0];
      const t = width * 0.12;
      return { mode: 'fill', commands: [
        { op: 'M', x: p.x + nib.x - t, y: p.y + nib.y + t }, { op: 'L', x: p.x + nib.x + t, y: p.y + nib.y - t },
        { op: 'L', x: p.x - nib.x + t, y: p.y - nib.y - t }, { op: 'L', x: p.x - nib.x - t, y: p.y - nib.y + t }, { op: 'Z' },
      ] };
    }
    return { mode: 'fill', commands: calligraphyOutline(s, width, usePressure) };
  }
  const r = radii(style, s, width, usePressure);
  if (s.length === 1) return { mode: 'fill', commands: circlePath(s[0].x, s[0].y, r[0]) };
  return { mode: 'fill', commands: buildCapsuleOutline(s, r, true) };
}

/** Map a shape's points (e.g. PDF → screen). */
export function mapShape(shape: InkShape, map: (x: number, y: number) => { x: number; y: number }): InkShape {
  return {
    mode: shape.mode,
    commands: shape.commands.map((c) => {
      if (c.op === 'Z') return c;
      if (c.op === 'C') {
        const p1 = map(c.x1, c.y1);
        const p2 = map(c.x2, c.y2);
        const p = map(c.x, c.y);
        return { op: 'C', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, x: p.x, y: p.y };
      }
      const p = map(c.x, c.y);
      return { op: c.op, x: p.x, y: p.y };
    }),
  };
}
