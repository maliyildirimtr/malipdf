import { describe, expect, it } from 'vitest';
import { findScribbleTargets, isScribbleGesture } from '../scribbleErase';
import { pressureWidth } from '../inkGeometry';
import type { Annotation, InputPoint } from '../../types/annotations';

function makePoints(coords: [number, number][]): InputPoint[] {
  return coords.map(([x, y], i) => ({ x, y, pressure: 0.5, timestamp: i * 10 }));
}

describe('scribbleErase', () => {
  it('recognizes a horizontal back-and-forth scribble over a word', () => {
    const pts: [number, number][] = [];
    // 5 horizontal passes back-and-forth across x = 100..260, y = 100..135
    for (let pass = 0; pass < 5; pass++) {
      const yBase = 100 + pass * 8;
      const forward = pass % 2 === 0;
      for (let s = 0; s <= 12; s++) {
        const t = s / 12;
        const x = forward ? 100 + t * 160 : 260 - t * 160;
        const y = yBase + Math.sin(t * Math.PI) * 3;
        pts.push([x, y]);
      }
    }
    expect(isScribbleGesture(makePoints(pts))).toBe(true);
  });

  it('recognizes a diagonal scribble with rounded U-turns', () => {
    const pts: [number, number][] = [];
    for (let pass = 0; pass < 4; pass++) {
      const offset = pass * 10;
      const forward = pass % 2 === 0;
      for (let s = 0; s <= 10; s++) {
        const t = s / 10;
        const u = forward ? t : 1 - t;
        const x = 50 + u * 120 + offset * 0.4;
        const y = 50 + u * 80 - offset * 0.6;
        pts.push([x, y]);
      }
    }
    expect(isScribbleGesture(makePoints(pts))).toBe(true);
  });

  it('does NOT trigger on normal left-to-right cursive handwriting ("mmmm")', () => {
    const pts: [number, number][] = [];
    // Steady rightward progress with 6 humps — never retraces earlier x span
    for (let i = 0; i <= 60; i++) {
      const x = 40 + i * 4;
      const y = 120 + Math.sin((i / 60) * Math.PI * 10) * 18;
      pts.push([x, y]);
    }
    expect(isScribbleGesture(makePoints(pts))).toBe(false);
  });

  it('does NOT trigger on a straight line, circle, or short tap', () => {
    const line = makePoints(Array.from({ length: 15 }, (_, i) => [i * 15, 50]));
    expect(isScribbleGesture(line)).toBe(false);

    const circle = makePoints(
      Array.from({ length: 32 }, (_, i) => {
        const a = (i / 31) * Math.PI * 2;
        return [200 + Math.cos(a) * 60, 200 + Math.sin(a) * 60];
      }),
    );
    expect(isScribbleGesture(circle)).toBe(false);

    expect(isScribbleGesture(makePoints([[10, 10], [12, 12], [11, 13]]))).toBe(false);
  });

  it('erases only unlocked annotations intersected by the scribble path', () => {
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

    const wordA = mkStroke('word-a', 100, 200, 180, 205);
    const wordB = mkStroke('word-b', 100, 400, 180, 405);
    const lockedWord = mkStroke('locked', 110, 202, 170, 202, true);

    const scribblePdf = [
      { x: 95, y: 198 },
      { x: 185, y: 204 },
      { x: 98, y: 208 },
      { x: 182, y: 200 },
    ];

    const hits = findScribbleTargets(scribblePdf, [wordA, wordB, lockedWord], 10);
    expect(hits.map((h) => h.id)).toEqual(['word-a']);
  });
});

describe('pressureWidth clamping', () => {
  it('clamps WebKit pressure glitches (>1, <0, NaN) to safe bounds', () => {
    expect(pressureWidth(4, 6.5)).toBeCloseTo(pressureWidth(4, 1));
    expect(pressureWidth(4, -2)).toBeCloseTo(pressureWidth(4, 0));
    expect(pressureWidth(4, Number.NaN)).toBeCloseTo(pressureWidth(4, 0.5));
  });
});
