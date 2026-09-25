import { describe, expect, it } from 'vitest';
import { PDFDocument, degrees } from 'pdf-lib';
import {
  buildPdfFromPlan,
  identityPlan,
  isIdentityPlan,
  planDelete,
  planDuplicate,
  planExtract,
  planInsertBlank,
  planInsertExternal,
  planMove,
  planRotate,
  remapAnnotationsForPlan,
  remapViewRotationsForPlan,
} from '../pagePlan';
import type { Annotation } from '../../types/annotations';

/** Page i is 100 × (100 + i) points, so heights identify pages after edits. */
async function pdf(count: number, heightBase = 100): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < count; i++) doc.addPage([100, heightBase + i]);
  return doc.save();
}
async function heights(bytes: Uint8Array): Promise<number[]> {
  return (await PDFDocument.load(bytes)).getPages().map((p) => p.getHeight());
}
const note = (id: string, pageIndex: number): Annotation => ({
  id, type: 'shape', shapeKind: 'line', pageIndex, startPoint: { x: 0, y: 0 }, endPoint: { x: 1, y: 1 },
  strokeWidth: 1, fillColor: 'transparent', color: '#000000', opacity: 1, locked: false, createdAt: 0, updatedAt: 0,
});

describe('page plan builders', () => {
  it('describe each operation as an ordered page list', () => {
    expect(isIdentityPlan(identityPlan(3), 3)).toBe(true);
    expect(planInsertBlank(3, 0)).toEqual([{ kind: 'existing', from: 0 }, { kind: 'blank', likePage: 0 }, { kind: 'existing', from: 1 }, { kind: 'existing', from: 2 }]);
    expect(planDuplicate(3, [1]).map((e) => e.kind === 'existing' && e.from)).toEqual([0, 1, 1, 2]);
    expect(planDelete(3, [0, 2]).map((e) => e.kind === 'existing' && e.from)).toEqual([1]);
    expect(() => planDelete(2, [0, 1])).toThrow(/at least one page/);
    expect(planRotate(2, [1], 90)[1]).toEqual({ kind: 'existing', from: 1, rotateBy: 90 });
    expect(planMove(5, [3], 0).map((e) => e.kind === 'existing' && e.from)).toEqual([3, 0, 1, 2, 4]);
    expect(planMove(5, [0, 1], 5).map((e) => e.kind === 'existing' && e.from)).toEqual([2, 3, 4, 0, 1]);
    expect(planMove(5, [1, 3], 3).map((e) => e.kind === 'existing' && e.from)).toEqual([0, 2, 1, 3, 4]);
    expect(planInsertExternal(2, 1, 2).map((e) => e.kind)).toEqual(['existing', 'existing', 'external', 'external']);
    expect(planExtract([2, 0, 2]).map((e) => e.kind === 'existing' && e.from)).toEqual([0, 2]);
  });
});

describe('buildPdfFromPlan (pdf-lib)', () => {
  it('reorders, duplicates and deletes the real pages', async () => {
    const src = await pdf(4);
    expect(await heights(await buildPdfFromPlan(src, planMove(4, [3], 0)))).toEqual([103, 100, 101, 102]);
    expect(await heights(await buildPdfFromPlan(src, planDuplicate(4, [1])))).toEqual([100, 101, 101, 102, 103]);
    expect(await heights(await buildPdfFromPlan(src, planDelete(4, [1, 2])))).toEqual([100, 103]);
  });

  it('inserts a blank page shaped like its neighbour, and pages from another PDF', async () => {
    const src = await pdf(2);
    expect(await heights(await buildPdfFromPlan(src, planInsertBlank(2, 1)))).toEqual([100, 101, 101]);
    const other = await pdf(2, 500);
    expect(await heights(await buildPdfFromPlan(src, planInsertExternal(2, 0, 2), other))).toEqual([100, 500, 501, 101]);
  });

  it('persists page rotation in the file', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]).setRotation(degrees(90));
    doc.addPage([100, 100]);
    const out = await PDFDocument.load(await buildPdfFromPlan(await doc.save(), planRotate(2, [0, 1], 90)));
    expect(out.getPages().map((p) => p.getRotation().angle)).toEqual([180, 90]);
  });

  it('extracts a subset (export selected pages)', async () => {
    expect(await heights(await buildPdfFromPlan(await pdf(5), planExtract([4, 1])))).toEqual([101, 104]);
  });
});

describe('annotations and view rotations follow their pages', () => {
  it('moves, drops and duplicates annotations', () => {
    const anns = [note('a', 0), note('b', 1), note('c', 2)];
    const moved = remapAnnotationsForPlan(anns, planMove(3, [2], 0));
    expect(moved.map((a) => [a.id, a.pageIndex])).toEqual([['c', 0], ['a', 1], ['b', 2]]);

    expect(remapAnnotationsForPlan(anns, planDelete(3, [1])).map((a) => [a.id, a.pageIndex]))
      .toEqual([['a', 0], ['c', 1]]);

    const dup = remapAnnotationsForPlan(anns, planDuplicate(3, [0]));
    expect(dup.filter((a) => a.pageIndex <= 1).map((a) => a.pageIndex)).toEqual([0, 1]);
    expect(dup[0].id).toBe('a');
    expect(dup[1].id).not.toBe('a');
  });

  it('carries view rotations', () => {
    expect(remapViewRotationsForPlan({ 0: 90, 2: 180 }, planMove(3, [2], 0))).toEqual({ 0: 180, 1: 90 });
  });
});
