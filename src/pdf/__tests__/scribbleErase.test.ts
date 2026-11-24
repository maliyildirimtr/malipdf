import { describe, expect, it } from 'vitest';
import { findScribbleTargets, isScribbleGesture } from '../scribbleErase';
import { pressureWidth } from '../inkGeometry';
import type { Annotation, InputPoint } from '../../types/annotations';

function makePoints(coords: [number, number][]): InputPoint[] {
  return coords.map(([x, y], i) => ({ x, y, pressure: 0.5, timestamp: i * 10 }));
}

describe('scribbleErase (ultra-strict)', () => {
  it('recognizes a deliberate 5-pass horizontal scratch-out over a word', () => {
    const pts: [number, number][] = [];
    for (let pass = 0; pass < 6; pass++) {
      const yBase = 100 + pass * 6;
      const forward = pass % 2 === 0;
      for (let s = 0; s <= 12; s++) {
        const t = s / 12;
        const x = forward ? 100 + t * 160 : 260 - t * 160;
        const y = yBase + Math.sin(t * Math.PI) * 2;
        pts.push([x, y]);
      }
    }
    expect(isScribbleGesture(makePoints(pts))).toBe(true);
  });

  it('recognizes a deliberate 5-pass diagonal scratch-out', () => {
    const pts: [number, number][] = [];
    for (let pass = 0; pass < 5; pass++) {
      const offset = pass * 7;
      const forward = pass % 2 === 0;
      for (let s = 0; s <= 10; s++) {
        const t = s / 10;
        const u = forward ? t : 1 - t;
        const x = 50 + u * 130 + offset * 0.35;
        const y = 50 + u * 80 - offset * 0.55;
        pts.push([x, y]);
      }
    }
    expect(isScribbleGesture(makePoints(pts))).toBe(true);
  });

  it('does NOT trigger on cursive handwriting ("mmmm"), loops ("8"), or short letters', () => {
    // Cursive "mmmm" moving right
    const cursive: [number, number][] = [];
    for (let i = 0; i <= 60; i++) {
      cursive.push([40 + i * 4, 120 + Math.sin((i / 60) * Math.PI * 10) * 18]);
    }
    expect(isScribbleGesture(makePoints(cursive))).toBe(false);

    // Figure-8 / looped letter drawn in place
    const loop8: [number, number][] = [];
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      loop8.push([100 + Math.sin(a) * 18, 100 + Math.sin(a * 2) * 24]);
    }
    expect(isScribbleGesture(makePoints(loop8))).toBe(false);

    // Short 2-pass zig-zag ("z" / "N")
    const letterZ = makePoints([
      [100, 100], [130, 100], [100, 130], [130, 130],
    ]);
    expect(isScribbleGesture(letterZ)).toBe(false);
  });

  it('erases ONLY strokes genuinely crossed multiple times, NEVER adjacent edge-brushed strokes or photos', () => {
    const mkStroke = (id: string, x0: number, y0: number, x1: number, y1: number, locked = false): Annotation => ({
      id,
      pageIndex: 0,
      type: 'stroke',
      points: [
        { x: x0, y: y0, pressure: 0.5, timestamp: 0 },
        { x: x1, y: y1, pressure: 0.5, timestamp: 1 },
      ],
      color: '#ef4444',
      width: 3,
      opacity: 1,
      smooth: true,
      pressure: false,
      locked,
      createdAt: 0,
      updatedAt: 0,
    });

    const targetWord = mkStroke('target', 100, 200, 180, 204);
    const neighborRight = mkStroke('neighbor-edge', 184, 198, 260, 202); // sits right next to scribble edge
    const lockedWord = mkStroke('locked', 110, 202, 170, 202, true);
    const photo: Annotation = {
      id: 'photo',
      pageIndex: 0,
      type: 'image',
      x: 90,
      y: 180,
      width: 120,
      height: 80,
      assetId: 'a1',
      color: '#000',
      opacity: 1,
      locked: false,
      createdAt: 0,
      updatedAt: 0,
    };

    const scribblePdf = [
      { x: 95, y: 196 },
      { x: 182, y: 202 },
      { x: 98, y: 208 },
      { x: 182, y: 200 },
      { x: 96, y: 204 },
      { x: 180, y: 198 },
    ];

    const hits = findScribbleTargets(scribblePdf, [targetWord, neighborRight, lockedWord, photo], 4);
    expect(hits.map((h) => h.id)).toEqual(['target']);
  });
});

describe('pressureWidth clamping', () => {
  it('clamps WebKit pressure glitches (>1, <0, NaN) to safe bounds', () => {
    expect(pressureWidth(4, 6.5)).toBeCloseTo(pressureWidth(4, 1));
    expect(pressureWidth(4, -2)).toBeCloseTo(pressureWidth(4, 0));
    expect(pressureWidth(4, Number.NaN)).toBeCloseTo(pressureWidth(4, 0.5));
  });
});
