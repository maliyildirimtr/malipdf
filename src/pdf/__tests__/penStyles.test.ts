import { describe, expect, it } from 'vitest';
import { pointerTilt, styledPenShape, mapShape } from '../penStyles';
import { extendedBox, MAX_PAGE_HEIGHT } from '../../commands/extendPageCommands';
import type { InputPoint, PenStyle } from '../../types/annotations';

const line = (n = 20, tilt = 0): InputPoint[] => Array.from({ length: n }, (_, i) => ({ x: i * 3, y: 10, pressure: 0.3 + (i / n) * 0.5, timestamp: i * 8, tilt }));

function bounds(points: InputPoint[], style: PenStyle) {
  const shape = styledPenShape(points, 4, true, true, style);
  const ys = shape.commands.flatMap((c) => ('y' in c ? [c.y] : []));
  return { shape, height: Math.max(...ys) - Math.min(...ys) };
}

describe('pen styles', () => {
  it('reads stylus tilt and ignores mouse', () => {
    expect(pointerTilt({ pointerType: 'mouse', tiltX: 40, tiltY: 0 })).toBeUndefined();
    expect(pointerTilt({ pointerType: 'pen', altitudeAngle: Math.PI / 2 })).toBeUndefined();
    expect(pointerTilt({ pointerType: 'pen', altitudeAngle: Math.PI / 6 })).toBe(1);
    expect(pointerTilt({ pointerType: 'pen', tiltX: 30, tiltY: 0 })).toBeCloseTo(0.5, 1);
  });

  it('every style makes a closed, filled outline', () => {
    for (const style of ['fountain', 'calligraphy', 'pencil', 'marker'] as PenStyle[]) {
      const { shape } = bounds(line(), style);
      expect(shape.mode).toBe('fill');
      expect(shape.commands[0].op).toBe('M');
      expect(shape.commands[shape.commands.length - 1].op).toBe('Z');
    }
    expect(styledPenShape(line(1), 4, true, true, 'marker').mode).toBe('fill');
  });

  it('tilting a pencil shades wider', () => {
    expect(bounds(line(20, 1), 'pencil').height).toBeGreaterThan(bounds(line(20, 0), 'pencil').height * 1.8);
  });

  it('a calligraphy nib is thick across and thin along its angle', () => {
    const horizontal = bounds(line(), 'calligraphy').height;
    const diagonal: InputPoint[] = Array.from({ length: 20 }, (_, i) => ({ x: i * 3 * Math.cos(0.7), y: i * 3 * Math.sin(0.7), pressure: 0.5, timestamp: i * 8 }));
    const shape = styledPenShape(diagonal, 4, true, false, 'calligraphy');
    // Along the nib direction the ribbon is a hairline: its area is small.
    let area = 0;
    const pts = shape.commands.flatMap((c) => ('x' in c ? [c] : [])) as { x: number; y: number }[];
    for (let i = 0; i < pts.length; i++) { const a = pts[i]; const b = pts[(i + 1) % pts.length]; area += a.x * b.y - b.x * a.y; }
    expect(Math.abs(area / 2)).toBeLessThan(horizontal * 57 * 0.4);
  });

  it('maps shapes point by point', () => {
    const shape = mapShape(styledPenShape(line(), 4, false, false, 'marker'), (x, y) => ({ x: x * 2, y: -y }));
    expect(shape.commands.some((c) => 'y' in c && c.y < 0)).toBe(true);
  });
});

describe('endless page', () => {
  it('grows the box downwards, up to the PDF limit', () => {
    expect(extendedBox({ x: 0, y: 0, width: 595, height: 842 }, 421)).toEqual({ x: 0, y: -421, width: 595, height: 1263 });
    expect(extendedBox({ x: 0, y: 0, width: 595, height: MAX_PAGE_HEIGHT }, 100)).toBeNull();
  });
});
