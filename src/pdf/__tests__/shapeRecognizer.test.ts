import { describe, expect, it } from 'vitest';
import { recognizeShape } from '../shapeRecognizer';

// Deterministic "hand" jitter.
const jitter = (i: number, amount: number) => Math.sin(i * 12.9898) * amount;
const line = (n = 40) => Array.from({ length: n }, (_, i) => ({ x: 10 + i * 5 + jitter(i, 0.8), y: 20 + i * 2 + jitter(i + 7, 0.8) }));
const ellipse = (rx: number, ry: number, n = 80, close = 1.0) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const t = (i / n) * Math.PI * 2 * close;
    return { x: 100 + Math.cos(t) * rx + jitter(i, 1.5), y: 100 + Math.sin(t) * ry + jitter(i + 3, 1.5) };
  });
const polyline = (corners: { x: number; y: number }[], perSide = 20) => {
  const out: { x: number; y: number }[] = [];
  for (let c = 0; c < corners.length; c++) {
    const a = corners[c];
    const b = corners[(c + 1) % corners.length];
    for (let i = 0; i < perSide; i++) {
      const t = i / perSide;
      out.push({ x: a.x + (b.x - a.x) * t + jitter(out.length, 1), y: a.y + (b.y - a.y) * t + jitter(out.length + 5, 1) });
    }
  }
  out.push({ ...corners[0] });
  return out;
};

describe('ink to shape', () => {
  it('recognises a straight line', () => {
    expect(recognizeShape(line())?.kind).toBe('line');
  });

  it('recognises circles and ellipses', () => {
    expect(recognizeShape(ellipse(60, 60))?.kind).toBe('ellipse');
    expect(recognizeShape(ellipse(90, 40))).toMatchObject({ kind: 'ellipse' });
  });

  it('recognises an axis-aligned rectangle', () => {
    const shape = recognizeShape(polyline([{ x: 0, y: 0 }, { x: 150, y: 0 }, { x: 150, y: 90 }, { x: 0, y: 90 }]));
    expect(shape?.kind).toBe('rectangle');
  });

  it('turns triangles and rotated squares into polygons', () => {
    const triangle = recognizeShape(polyline([{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 60, y: 100 }]));
    expect(triangle).toMatchObject({ kind: 'polygon' });
    expect(triangle?.kind === 'polygon' && triangle.points).toHaveLength(3);
    const diamond = recognizeShape(polyline([{ x: 60, y: 0 }, { x: 120, y: 60 }, { x: 60, y: 120 }, { x: 0, y: 60 }]));
    expect(diamond?.kind === 'polygon' && diamond.points).toHaveLength(4);
  });

  it('leaves handwriting, open curves and tiny marks as ink', () => {
    const scribble = Array.from({ length: 120 }, (_, i) => ({ x: i * 2, y: 50 + Math.sin(i / 3) * 20 + (i % 7) * 3 }));
    expect(recognizeShape(scribble)).toBeNull();
    const arc = ellipse(60, 60, 80, 0.5);
    expect(recognizeShape(arc)).toBeNull();
    expect(recognizeShape([{ x: 0, y: 0 }, { x: 3, y: 2 }])).toBeNull();
  });
});
