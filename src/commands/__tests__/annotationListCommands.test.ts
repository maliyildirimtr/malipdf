import { beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { deleteAnnotation, describeAnnotation, matchesFilter, patchAnnotation } from '../annotationListCommands';
import { executeUndo } from '../historyCommands';
import { useDocumentStore } from '../../store/documentStore';
import { useAnnotationStore } from '../../store/annotationStore';
import { useHistoryStore } from '../../store/historyStore';
import { exportAnnotatedPdf } from '../../pdf/annotationExporter';
import { hitTestAnnotations } from '../../pdf/annotationHitTest';
import type { Annotation } from '../../types/annotations';

const line = (id: string): Annotation => ({
  id, type: 'shape', shapeKind: 'line', pageIndex: 0, startPoint: { x: 0, y: 0 }, endPoint: { x: 100, y: 0 },
  strokeWidth: 4, fillColor: 'transparent', color: '#000000', opacity: 1, locked: false, createdAt: 0, updatedAt: 0,
});
const page = () => useAnnotationStore.getState().getPageAnnotations('L', 0);

describe('annotations panel actions', () => {
  beforeEach(() => {
    useDocumentStore.setState({ documents: new Map(), tabOrder: [], activeDocId: null });
    useAnnotationStore.setState({ docAnnotations: new Map() });
    useHistoryStore.setState({ histories: new Map() });
    useDocumentStore.getState().openDocument({
      id: 'L', instanceId: 1, title: 'l.pdf', filePath: null, currentStateId: 's0', savedStateId: 's0',
      saveStatus: 'idle', lastSaveError: null, sourceData: new Uint8Array(), sourceRevision: 1,
      activePageIndex: 0, pageCount: 1, zoom: 1, zoomMode: 'custom', scrollTop: 0, scrollLeft: 0, pageRotations: {},
    });
    useAnnotationStore.getState().initDocument('L');
    useHistoryStore.getState().initDocument('L');
    for (const id of ['a', 'b', 'c']) useAnnotationStore.getState().addAnnotation('L', line(id));
  });

  it('labels and filters', () => {
    expect(describeAnnotation(line('x'))).toBe('Line');
    expect(matchesFilter(line('x'), 'shape')).toBe(true);
    expect(matchesFilter(line('x'), 'pen')).toBe(false);
  });

  it('hide / lock are undoable and make the annotation unhittable', () => {
    patchAnnotation('L', page()[1], { hidden: true });
    expect(page()[1].hidden).toBe(true);
    const transform = { scale: 1 } as never;
    expect(hitTestAnnotations({ x: 50, y: 0 }, [page()[1]], transform)).toBeNull();
    executeUndo('L');
    expect(page()[1].hidden).toBeFalsy();

    patchAnnotation('L', page()[0], { locked: true });
    expect(page()[0].locked).toBe(true);
  });

  it('delete keeps stacking order on undo', () => {
    deleteAnnotation('L', page()[1]);
    expect(page().map((a) => a.id)).toEqual(['a', 'c']);
    executeUndo('L');
    expect(page().map((a) => a.id)).toEqual(['a', 'b', 'c']);
  });

  it('hidden annotations are left out of Save/Export', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    const result = await exportAnnotatedPdf(await doc.save(), new Map([[0, [line('v'), { ...line('h'), hidden: true }]]]));
    expect(result.annotationCount).toBe(1);
  });
});
