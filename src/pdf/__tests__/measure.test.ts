import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { labelAnchor, measureLabel, polygonArea, realArea, realLength } from '../measure';
import { exportAnnotatedPdf } from '../annotationExporter';
import { getAnnotationBounds } from '../annotationGeometry';
import { hitTestAnnotation } from '../annotationHitTest';
import type { Annotation, MeasureAnnotation } from '../../types/annotations';

const CM = 72 / 2.54; // points per centimetre

const measure = (patch: Partial<MeasureAnnotation>): MeasureAnnotation => ({
  id: 'm', pageIndex: 0, type: 'measure', kind: 'distance',
  points: [{ x: 10, y: 10 }, { x: 10 + 5 * CM, y: 10 }],
  calibration: { scale: 1, unit: 'cm' }, strokeWidth: 1.25, color: '#d9480f', opacity: 1,
  locked: false, createdAt: 0, updatedAt: 0, ...patch,
});

describe('measure', () => {
  it('converts paper points to real units with a scale', () => {
    expect(realLength(72, { scale: 1, unit: 'in' })).toBeCloseTo(1);
    expect(realLength(CM, { scale: 100, unit: 'm' })).toBeCloseTo(1);
    expect(realArea(CM * CM, { scale: 1, unit: 'mm' })).toBeCloseTo(100);
  });

  it('labels distances and areas', () => {
    expect(measureLabel(measure({}))).toBe('5.00 cm');
    expect(measureLabel(measure({ calibration: { scale: 50, unit: 'm' } }))).toBe('2.50 m');
    const square = [{ x: 0, y: 0 }, { x: 2 * CM, y: 0 }, { x: 2 * CM, y: 2 * CM }, { x: 0, y: 2 * CM }];
    expect(polygonArea(square)).toBeCloseTo(4 * CM * CM);
    expect(measureLabel(measure({ kind: 'area', points: square }))).toBe('4.00 cm²');
    const c = labelAnchor({ kind: 'area', points: square });
    expect(c.x).toBeCloseTo(CM);
    expect(c.y).toBeCloseTo(CM);
  });

  it('is hit near its line and has padded bounds', () => {
    const m = measure({});
    expect(hitTestAnnotation({ x: 50, y: 12 }, m, 2)).toBe(true);
    expect(hitTestAnnotation({ x: 50, y: 40 }, m, 2)).toBe(false);
    expect(getAnnotationBounds(m).y).toBeLessThan(10);
  });

  it('exports line, ticks and label (with ² in WinAnsi)', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([300, 300]);
    const square = [{ x: 20, y: 20 }, { x: 100, y: 20 }, { x: 100, y: 100 }, { x: 20, y: 100 }];
    const out = await exportAnnotatedPdf(await doc.save(), new Map([[0, [measure({}), measure({ id: 'a', kind: 'area', points: square })] as Annotation[]]]));
    expect(out.annotationCount).toBe(2);
    await expect(PDFDocument.load(out.data)).resolves.toBeDefined();
  });
});
