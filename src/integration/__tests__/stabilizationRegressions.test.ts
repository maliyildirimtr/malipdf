/**
 * Regression tests for the 2026-09 stabilization pass. Each test drives the
 * real production functions/stores (no mocks of the code under test).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { exportAnnotatedPdf } from '../../pdf/annotationExporter';
import { eraseStrokePath } from '../../pdf/eraserGeometry';
import { computeResizeTargetBounds } from '../../pdf/annotationTransform';
import { getResizeHandles } from '../../pdf/annotationHitTest';
import { DocumentManager } from '../../pdf/documentManager';
import { useDocumentStore } from '../../store/documentStore';
import { useAnnotationStore } from '../../store/annotationStore';
import { useHistoryStore, makeBatchAction, makeRemoveAction } from '../../store/historyStore';
import { executeRedo, executeUndo } from '../../commands/historyCommands';
import type { Annotation, DocumentState, InputPoint } from '../../types/annotations';

const ONE_PX_PNG = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
));

async function blankPdf(pages = 1): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([300, 300]);
  return doc.save();
}

const base = { color: '#000000', opacity: 1, locked: false, createdAt: 0, updatedAt: 0 };
const pt = (x: number, y: number): InputPoint => ({ x, y, pressure: 0.5, timestamp: 0 });

function stroke(id: string, points: InputPoint[] = [pt(0, 0), pt(5, 5)]): Annotation {
  return { ...base, id, type: 'stroke', pageIndex: 0, points, width: 1, smooth: false, pressure: false };
}

describe('export: previously failing document contents', () => {
  it('exports a Polygon (freeform) annotation', async () => {
    const polygon: Annotation = {
      ...base, id: 'poly', type: 'freeform', pageIndex: 0,
      points: [{ x: 10, y: 10 }, { x: 100, y: 10 }, { x: 50, y: 90 }],
      strokeWidth: 2, fillColor: '#ff0000',
    };
    const result = await exportAnnotatedPdf(await blankPdf(), new Map([[0, [polygon]]]));
    expect(result.annotationCount).toBe(1);
  });

  it('exports an image annotation shaped exactly like a printout page', async () => {
    const image: Annotation = {
      ...base, id: 'img', type: 'image', pageIndex: 0, x: 0, y: 0, width: 300, height: 300, assetId: 'a',
    };
    const assets = new Map([['a', { id: 'a', mimeType: 'image/png' as const, width: 1, height: 1, data: ONE_PX_PNG }]]);
    const result = await exportAnnotatedPdf(await blankPdf(), new Map([[0, [image]]]), { assets });
    expect(result.annotationCount).toBe(1);
  });

  it('saves new annotations into a file MaliPDF saved before (re-save)', async () => {
    const first = await exportAnnotatedPdf(await blankPdf(), new Map([[0, [stroke('a')]]]));
    const second = await exportAnnotatedPdf(first.data, new Map([[0, [stroke('b')]]]));
    expect(second.annotationCount).toBe(1);
  });

  it('reports a clear, actionable error for Turkish text when Unicode fonts are unavailable', async () => {
    const text: Annotation = {
      ...base, id: 't', type: 'text', pageIndex: 0,
      bounds: { x: 10, y: 10, width: 200, height: 60 }, content: 'Çalışma ğüşİı',
      fontSize: 12, fontFamily: 'Inter', bold: false, italic: false, underline: false,
      align: 'left', backgroundColor: 'transparent',
    };
    await expect(exportAnnotatedPdf(await blankPdf(), new Map([[0, [text]]])))
      .rejects.toThrow(/npm install/);
  });
});

describe('eraser: untouched strokes stay untouched', () => {
  it('returns the original points (no resampling) when the eraser misses', () => {
    const points = [pt(0, 0), pt(10, 0), pt(20, 0), pt(30, 0)];
    const result = eraseStrokePath(points, 2, { x: 500, y: 500 }, { x: 501, y: 501 }, 5);
    expect(result.erased).toBe(false);
    expect(result.segments).toEqual([points]);
    expect(result.segments[0]).toBe(points);
  });

  it('splits a stroke the eraser crosses', () => {
    const points = [pt(0, 0), pt(100, 0)];
    const result = eraseStrokePath(points, 2, { x: 50, y: -20 }, { x: 50, y: 20 }, 3);
    expect(result.erased).toBe(true);
    expect(result.segments).toHaveLength(2);
  });
});

describe('resize: every handle moves its own edge (PDF space, y up)', () => {
  const bounds = { x: 10, y: 10, width: 100, height: 50 };
  const handles = Object.fromEntries(getResizeHandles(bounds).map((h) => [h.id, h]));

  it('keeps the size unchanged when the pointer stays on the grabbed handle', () => {
    for (const handle of Object.values(handles)) {
      expect(computeResizeTargetBounds(bounds, handle.id, handle)).toEqual(bounds);
    }
  });

  it('n moves the top edge and anchors the bottom', () => {
    expect(computeResizeTargetBounds(bounds, 'n', { x: 60, y: 80 }))
      .toEqual({ x: 10, y: 10, width: 100, height: 70 });
  });

  it('s moves the bottom edge and anchors the top', () => {
    expect(computeResizeTargetBounds(bounds, 's', { x: 60, y: 0 }))
      .toEqual({ x: 10, y: 0, width: 100, height: 60 });
  });

  it('image aspect lock on se anchors the opposite (top-left) corner', () => {
    const target = computeResizeTargetBounds(bounds, 'se', { x: 210, y: 10 }, true);
    expect(target.x).toBe(10);
    expect(target.y + target.height).toBe(60); // top edge unchanged
    expect(target.width / target.height).toBeCloseTo(2);
  });
});

function openTestDoc(docId: string, sourceData = new Uint8Array()): void {
  const doc: DocumentState = {
    id: docId, instanceId: 1, title: 't.pdf', filePath: '/t.pdf',
    currentStateId: 's0', savedStateId: 's0', saveStatus: 'idle', lastSaveError: null,
    sourceData, sourceRevision: 1, activePageIndex: 0, pageCount: 1,
    zoom: 1, zoomMode: 'custom', scrollTop: 0, scrollLeft: 0, pageRotations: {},
  };
  useDocumentStore.getState().openDocument(doc);
  useAnnotationStore.getState().initDocument(docId);
  useHistoryStore.getState().initDocument(docId);
}

describe('undo restores z-order', () => {
  beforeEach(() => {
    useDocumentStore.setState({ documents: new Map(), tabOrder: [], activeDocId: null });
    useAnnotationStore.setState({ docAnnotations: new Map() });
    useHistoryStore.setState({ histories: new Map() });
  });

  const order = (docId: string) => useAnnotationStore.getState().getPageAnnotations(docId, 0).map((a) => a.id);

  it('undo of deleting the middle annotation puts it back in the middle', () => {
    openTestDoc('z1');
    const [a, b, c] = [stroke('A'), stroke('B'), stroke('C')];
    for (const ann of [a, b, c]) useAnnotationStore.getState().addAnnotation('z1', ann);
    useAnnotationStore.getState().setPageAnnotations('z1', 0, [a, c]);
    useHistoryStore.getState().push(makeRemoveAction('z1', b, 1));

    executeUndo('z1');
    expect(order('z1')).toEqual(['A', 'B', 'C']);
    executeRedo('z1');
    expect(order('z1')).toEqual(['A', 'C']);
  });

  it('undo/redo of an erase-split batch keeps pieces in place', () => {
    openTestDoc('z2');
    const [a, b, c] = [stroke('A'), stroke('B'), stroke('C')];
    for (const ann of [a, b, c]) useAnnotationStore.getState().addAnnotation('z2', ann);
    const [b1, b2] = [stroke('B1'), stroke('B2')];
    useAnnotationStore.getState().setPageAnnotations('z2', 0, [a, b1, b2, c]);
    useHistoryStore.getState().push(makeBatchAction('z2', [
      { type: 'REMOVE_ANNOTATION', docId: 'z2', pageIndex: 0, annotationId: 'B', index: 1, before: b, after: null },
      { type: 'ADD_ANNOTATION', docId: 'z2', pageIndex: 0, annotationId: 'B1', index: 1, before: null, after: b1 },
      { type: 'ADD_ANNOTATION', docId: 'z2', pageIndex: 0, annotationId: 'B2', index: 2, before: null, after: b2 },
    ]));

    executeUndo('z2');
    expect(order('z2')).toEqual(['A', 'B', 'C']);
    executeRedo('z2');
    expect(order('z2')).toEqual(['A', 'B1', 'B2', 'C']);
  });
});

describe('DocumentManager reload ordering', () => {
  it('a slow older reload never replaces a newer one', async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    let opened = false;
    const manager = new DocumentManager((data) => {
      const numPages = data[0];
      const proxy = { numPages, destroy: async () => {}, getPage: async () => ({}) } as never;
      if (!opened) { opened = true; return Promise.resolve(proxy); }
      return new Promise((resolve) => resolvers.push(() => resolve(proxy)));
    });
    const { identity } = await manager.openDocument('R', new Uint8Array([1]));

    const older = manager.reloadDocument(identity, new Uint8Array([2]), 2);
    const newer = manager.reloadDocument(identity, new Uint8Array([3]), 3);
    resolvers[1](undefined); // newer finishes first
    await expect(newer).resolves.toBe(3);
    resolvers[0](undefined);
    await expect(older).resolves.toBeNull();
    expect(manager.getPageCount(identity)).toBe(3);
    expect(manager.getLoadedRevision(identity)).toBe(3);
  });
});
