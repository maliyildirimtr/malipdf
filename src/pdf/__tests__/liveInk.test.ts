import { describe, expect, it } from 'vitest';
import type { InputPoint } from '../../types/annotations';
import {
  penShape,
  stabilizePoints,
  uniformStrokeOutline,
  type InkStabilizer,
  type PathCommand,
} from '../inkGeometry';
import { LiveInkBuilder, UNIFORM_FILL_MIN_WIDTH, type LiveInkStyle } from '../liveInk';

/** Deterministic pseudo-random numbers. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** A handwriting-like stroke: loops, speed changes, pauses (duplicate points), pressure noise. */
function makeStroke(n: number, seed: number, pressure = true): InputPoint[] {
  const r = rng(seed);
  const pts: InputPoint[] = [];
  let x = 100, y = 100, heading = 0, speed = 2;
  for (let i = 0; i < n; i++) {
    heading += (r() - 0.5) * 0.9;
    speed = Math.max(0, Math.min(8, speed + (r() - 0.5) * 1.5));
    if (r() < 0.05) speed = 0; // the pen rests
    x += Math.cos(heading) * speed + (r() - 0.5) * 0.3;
    y += Math.sin(heading) * speed + (r() - 0.5) * 0.3;
    pts.push({ x, y, pressure: pressure ? 0.2 + 0.6 * r() : 0.5, timestamp: i * 4 });
  }
  return pts;
}

/** Full-stroke geometry, exactly as annotationRenderer builds it for the preview/committed stroke. */
function fullShape(style: LiveInkStyle, points: InputPoint[]): { mode: 'fill' | 'stroke'; commands: PathCommand[] } {
  if (style.kind === 'highlighter') {
    // renderHighlight draws nothing for fewer than two points.
    return { mode: 'fill', commands: points.length < 2 ? [] : uniformStrokeOutline(points, style.width, true, false) };
  }
  const stabilized = stabilizePoints(points, style.stabilizer);
  const shape = penShape(stabilized, style.width, style.smooth, style.pressure);
  if (shape.mode === 'stroke' && style.width >= UNIFORM_FILL_MIN_WIDTH && stabilized.length >= 2) {
    return { mode: 'fill', commands: uniformStrokeOutline(stabilized, style.width, style.smooth, true) };
  }
  return shape;
}

/** Drops moveTo's that only restart a piece at the current point (stroke mode pieces). */
function normalize(commands: PathCommand[]): PathCommand[] {
  const out: PathCommand[] = [];
  let cur: { x: number; y: number } | null = null;
  for (const c of commands) {
    if (c.op === 'M' && cur && Math.abs(c.x - cur.x) < 1e-9 && Math.abs(c.y - cur.y) < 1e-9) continue;
    out.push(c);
    if (c.op !== 'Z') cur = { x: c.x, y: c.y };
  }
  return out;
}

function expectSameCommands(actual: PathCommand[], expected: PathCommand[]) {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) {
    const a = actual[i] as Record<string, number | string>;
    const e = expected[i] as Record<string, number | string>;
    expect(a.op).toBe(e.op);
    for (const k of Object.keys(e)) {
      if (k === 'op') continue;
      expect(Math.abs((a[k] as number) - (e[k] as number))).toBeLessThan(1e-9);
    }
  }
}

const STYLES: [string, LiveInkStyle][] = [
  ['pressure pen, basic stabilizer', { kind: 'pen', width: 3, smooth: true, pressure: true, stabilizer: 'basic' }],
  ['pressure pen, fluid stabilizer', { kind: 'pen', width: 6, smooth: true, pressure: true, stabilizer: 'fluid' }],
  ['pressure pen, no smoothing, stabilizer off', { kind: 'pen', width: 2, smooth: false, pressure: true, stabilizer: 'off' }],
  ['thin pen (centre line)', { kind: 'pen', width: 2, smooth: true, pressure: false, stabilizer: 'soft' }],
  ['thin pen, no smoothing', { kind: 'pen', width: 1.5, smooth: false, pressure: false, stabilizer: 'basic' }],
  ['thick uniform pen', { kind: 'pen', width: 8, smooth: true, pressure: false, stabilizer: 'silky' }],
  ['highlighter', { kind: 'highlighter', width: 18, smooth: true, pressure: false }],
];

describe('LiveInkBuilder (dry + wet == full outline)', () => {
  for (const [name, style] of STYLES) {
    it(`matches the full stroke at every step: ${name}`, () => {
      for (const seed of [1, 42]) {
        const stroke = makeStroke(100, seed, style.pressure);
        const r = rng(seed + 100);
        const builder = new LiveInkBuilder(style);
        let dry: PathCommand[] = [];
        let n = 0;
        while (n < stroke.length) {
          n = Math.min(stroke.length, n + 1 + Math.floor(r() * 3)); // 1–3 coalesced samples per event
          const points = stroke.slice(0, n);
          // Prediction is drawn but never kept; its pressure repeats the last real one.
          const last = points[points.length - 1];
          const predicted = r() < 0.5 ? [] : [1, 2].map((k) => ({ ...last, x: last.x + k * 2.5, y: last.y + k * 1.5 }));
          const frame = builder.update(points, predicted);
          if (frame.reset) dry = [];
          dry.push(...frame.dry);
          const expected = fullShape(style, [...points, ...predicted]);
          expect(frame.mode).toBe(expected.mode);
          expectSameCommands(normalize([...dry, ...frame.wet]), normalize(expected.commands));
        }
      }
    });
  }

  it('switches from constant width to pressure when the first real pressure arrives', () => {
    const style: LiveInkStyle = { kind: 'pen', width: 2, smooth: true, pressure: true, stabilizer: 'basic' };
    const stroke = makeStroke(30, 3).map((p, i) => (i < 10 ? { ...p, pressure: 0.5 } : p));
    const builder = new LiveInkBuilder(style);
    let dry: PathCommand[] = [];
    const resets: number[] = [];
    for (let n = 1; n <= stroke.length; n++) {
      const frame = builder.update(stroke.slice(0, n));
      if (frame.reset) { dry = []; resets.push(n); }
      dry.push(...frame.dry);
      expectSameCommands(normalize([...dry, ...frame.wet]), normalize(fullShape(style, stroke.slice(0, n)).commands));
    }
    expect(resets).toEqual([1, 11]);
  });

  it('keeps the per-event work bounded on a long stroke (no O(n) re-tessellation)', () => {
    const style: LiveInkStyle = { kind: 'pen', width: 3, smooth: true, pressure: true, stabilizer: 'basic' };
    const stroke = makeStroke(2000, 9);
    const builder = new LiveInkBuilder(style);
    let maxWet = 0;
    let maxDry = 0;
    for (let n = 2; n <= stroke.length; n += 2) {
      const frame = builder.update(stroke.slice(0, n));
      if (n > 50) {
        maxWet = Math.max(maxWet, frame.wet.length);
        maxDry = Math.max(maxDry, frame.dry.length);
      }
    }
    const full = fullShape(style, stroke).commands.length;
    // A full re-tessellation is tens of thousands of commands; the live tail stays tiny.
    expect(full).toBeGreaterThan(20000);
    expect(maxWet).toBeLessThan(full / 50);
    expect(maxDry).toBeLessThan(full / 50);
  });

  it('a single point is a dot of the nominal width', () => {
    const builder = new LiveInkBuilder({ kind: 'pen', width: 4, smooth: true, pressure: true, stabilizer: 'basic' });
    const frame = builder.update([{ x: 10, y: 10, pressure: 0.9, timestamp: 0 }]);
    expect(frame.mode).toBe('fill');
    expect(frame.dry).toEqual([]);
    const first = frame.wet[0] as { x: number };
    expect(first.x).toBeCloseTo(12);
  });
});

describe('stabilizer lag', () => {
  it('the drawn tip always reaches the pen and interior lag stays small at the default level', () => {
    const levels: InkStabilizer[] = ['basic', 'soft', 'silky', 'fluid'];
    // A straight line at constant speed (6 px per sample).
    const line: InputPoint[] = Array.from({ length: 60 }, (_, i) => ({ x: i * 6, y: 0, pressure: 0.5, timestamp: i * 8 }));
    for (const level of levels) {
      const out = stabilizePoints(line, level);
      expect(out[out.length - 1]).toEqual(line[line.length - 1]);
    }
    // 'basic' (the default): the EMA lags (1 - t) / t samples ≈ 0.27 × 6 px.
    const basic = stabilizePoints(line, 'basic');
    const interior = basic[40];
    expect(line[40].x - interior.x).toBeLessThan(2);
  });
});
