import { describe, expect, it } from 'vitest';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { exportAnnotatedPdf } from '../annotationExporter';
import { centerlinePath, circlePath, penShape, pressureOutline, simplifyInkPoints } from '../inkGeometry';
import { eraseStrokePath } from '../eraserGeometry';
import type { Annotation, InputPoint } from '../../types/annotations';

const wave = (n: number, pressure = 0.5): InputPoint[] =>
  Array.from({ length: n }, (_, i) => ({ x: 50 + i * 1.5, y: 400 + Math.sin(i / 10) * 40, pressure, timestamp: i }));
const base = { opacity: 1, locked: false, createdAt: 0, updatedAt: 0, pageIndex: 0, color: '#1d4ed8' };
const pen = (id: string, points: InputPoint[], extra: Partial<Annotation> = {}) =>
  ({ ...base, id, type: 'stroke', points, width: 2, smooth: true, pressure: false, ...extra } as Annotation);

async function blankPdf() {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  return doc.save();
}

describe('ink geometry', () => {
  it('smooth centre line starts and ends at the input end points', () => {
    const cmds = centerlinePath([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }], true);
    expect(cmds[0]).toEqual({ op: 'M', x: 0, y: 0 });
    expect(cmds.at(-1)).toEqual({ op: 'L', x: 20, y: 0 });
    expect(cmds.some((c) => c.op === 'C')).toBe(true);
  });

  it('a single point is a dot', () => {
    const shape = penShape([{ x: 5, y: 5, pressure: 0.5, timestamp: 0 }], 4, true, false);
    expect(shape.mode).toBe('fill');
    expect(shape.commands).toEqual(circlePath(5, 5, 2));
  });

  it('pressure strokes become one closed outline that widens with pressure', () => {
    const light = pressureOutline([{ x: 0, y: 0, pressure: 0.1, timestamp: 0 }, { x: 100, y: 0, pressure: 0.1, timestamp: 1 }], 4, false);
    const heavy = pressureOutline([{ x: 0, y: 0, pressure: 1, timestamp: 0 }, { x: 100, y: 0, pressure: 1, timestamp: 1 }], 4, false);
    const height = (cmds: typeof light) => {
      const ys = cmds.flatMap((c) => ('y' in c ? [c.y] : []));
      return Math.max(...ys) - Math.min(...ys);
    };
    expect(light.at(-1)).toEqual({ op: 'Z' });
    expect(height(heavy)).toBeGreaterThan(height(light) * 3);
    expect(height(heavy)).toBeCloseTo(4 * 1.7, 0);
  });

  it('simplification keeps the shape but drops redundant points', () => {
    const dense = Array.from({ length: 500 }, (_, i) => ({ x: i * 0.2, y: 0, pressure: 0.5, timestamp: i }));
    expect(simplifyInkPoints(dense, 0.1)).toHaveLength(2);
    const curve = wave(300);
    const simple = simplifyInkPoints(curve, 0.35);
    expect(simple.length).toBeLessThan(curve.length / 2);
    expect(simple[0]).toEqual(curve[0]);
    expect(simple.at(-1)).toEqual(curve.at(-1));
    // Pressure changes are kept when pressure matters.
    const pressed = dense.map((p, i) => ({ ...p, pressure: i < 250 ? 0.2 : 0.9 }));
    expect(simplifyInkPoints(pressed, 0.1, 2).length).toBeGreaterThan(2);
  });

  it('erasing does not multiply the number of points', () => {
    const points = wave(100);
    const result = eraseStrokePath(points, 2, { x: 110, y: 0 }, { x: 110, y: 900 }, 3);
    expect(result.erased).toBe(true);
    const total = result.segments.reduce((sum, segment) => sum + segment.length, 0);
    expect(total).toBeLessThan(points.length * 1.5);
  });
});

describe('ink export', () => {
  it('writes each stroke as one path with a shared graphics state (small and fast)', async () => {
    const strokes = Array.from({ length: 50 }, (_, k) => pen(`s${k}`, wave(150).map((p) => ({ ...p, y: p.y + k })), { opacity: 0.8 }));
    const started = performance.now();
    const result = await exportAnnotatedPdf(await blankPdf(), new Map([[0, strokes]]));
    const elapsed = performance.now() - started;
    const out = await PDFDocument.load(result.data);
    const gs = out.getPage(0).node.Resources()!.lookup(PDFName.of('ExtGState'), PDFDict);
    expect(gs.keys()).toHaveLength(1); // was one per tiny segment (thousands)
    expect(result.data.length).toBeLessThan(250 * 1024); // was ~2 MB
    expect(elapsed).toBeLessThan(3000); // was ~16 s
  });

  it('exports a dot', async () => {
    const result = await exportAnnotatedPdf(await blankPdf(), new Map([[0, [pen('dot', [{ x: 100, y: 100, pressure: 0.5, timestamp: 0 }])]]]));
    expect(result.annotationCount).toBe(1);
  });
});
