import { describe, it, expect } from 'vitest';
import { splitStrokePath } from '../eraserGeometry';
import type { InputPoint } from '../../types/annotations';

describe('Eraser Geometry', () => {
  it('splits middle erase -> 2 valid segments', () => {
    const points: InputPoint[] = [
      { x: 0, y: 0, pressure: 0.5, timestamp: 0 },
      { x: 10, y: 0, pressure: 0.5, timestamp: 1 },
      { x: 20, y: 0, pressure: 0.5, timestamp: 2 },
      { x: 30, y: 0, pressure: 0.5, timestamp: 3 },
    ];
    // Erase near x=15 with small radius so points aren't erased but segment is.
    const segments = splitStrokePath(points, 2, { x: 15, y: -10 }, { x: 15, y: 10 }, 1);
    expect(segments.length).toBe(2);
    expect(segments[0].length).toBeGreaterThanOrEqual(2);
    expect(segments[1].length).toBeGreaterThanOrEqual(2);
  });

  it('beginning erase -> remaining tail', () => {
    const points: InputPoint[] = [
      { x: 0, y: 0, pressure: 0.5, timestamp: 0 },
      { x: 10, y: 0, pressure: 0.5, timestamp: 1 },
      { x: 20, y: 0, pressure: 0.5, timestamp: 2 },
      { x: 30, y: 0, pressure: 0.5, timestamp: 3 },
    ];
    // Erase near x=5
    const segments = splitStrokePath(points, 2, { x: 5, y: -10 }, { x: 5, y: 10 }, 8);
    expect(segments.length).toBe(1);
    expect(segments[0].length).toBeGreaterThanOrEqual(2); // remaining tail
  });

  it('end erase -> remaining head', () => {
    const points: InputPoint[] = [
      { x: 0, y: 0, pressure: 0.5, timestamp: 0 },
      { x: 10, y: 0, pressure: 0.5, timestamp: 1 },
      { x: 20, y: 0, pressure: 0.5, timestamp: 2 },
      { x: 30, y: 0, pressure: 0.5, timestamp: 3 },
    ];
    // Erase near x=25
    const segments = splitStrokePath(points, 2, { x: 25, y: -10 }, { x: 25, y: 10 }, 8);
    expect(segments.length).toBe(1);
    expect(segments[0].length).toBeGreaterThanOrEqual(2); // remaining head
  });

  it('complete erase -> no annotation', () => {
    const points: InputPoint[] = [
      { x: 0, y: 0, pressure: 0.5, timestamp: 0 },
      { x: 10, y: 0, pressure: 0.5, timestamp: 1 },
      { x: 20, y: 0, pressure: 0.5, timestamp: 2 },
    ];
    const segments = splitStrokePath(points, 2, { x: 0, y: 0 }, { x: 20, y: 0 }, 10);
    expect(segments.length).toBe(0);
  });

  it('miss -> unchanged', () => {
    const points: InputPoint[] = [
      { x: 0, y: 0, pressure: 0.5, timestamp: 0 },
      { x: 10, y: 0, pressure: 0.5, timestamp: 1 },
      { x: 20, y: 0, pressure: 0.5, timestamp: 2 },
    ];
    // Erase far away
    const segments = splitStrokePath(points, 2, { x: 0, y: 100 }, { x: 20, y: 100 }, 5);
    expect(segments.length).toBe(1);
    expect(segments[0].length).toBeGreaterThanOrEqual(3);
  });
});
