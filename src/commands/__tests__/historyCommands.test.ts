import { beforeEach, describe, expect, it } from 'vitest';
import { executeRedo, executeUndo } from '..';
import { useAnnotationStore } from '../../store/annotationStore';
import {
  makeAddAction,
  makeMoveAction,
  makeRemoveAction,
  makeResizeAction,
  makeUpdateAction,
  useHistoryStore,
} from '../../store/historyStore';
import type { ShapeAnnotation } from '../../types/annotations';

const DOC_ID = 'document-A';

function rectangle(
  id: string,
  startX: number,
  endX: number,
): ShapeAnnotation {
  return {
    id,
    pageIndex: 0,
    type: 'shape',
    shapeKind: 'rectangle',
    startPoint: { x: startX, y: 10 },
    endPoint: { x: endX, y: 50 },
    color: '#ff0000',
    strokeWidth: 2,
    fillColor: 'transparent',
    opacity: 1,
    locked: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

beforeEach(() => {
  useHistoryStore.setState({ histories: new Map() });
  useAnnotationStore.setState({ docAnnotations: new Map() });
  useHistoryStore.getState().initDocument(DOC_ID);
  useAnnotationStore.getState().initDocument(DOC_ID);
});

describe('history command execution', () => {
  it('undoes and redoes ADD in history and annotation stores together', () => {
    const annotation = rectangle('added', 10, 50);
    useAnnotationStore.getState().addAnnotation(DOC_ID, annotation);
    useHistoryStore.getState().push(makeAddAction(DOC_ID, annotation));

    expect(executeUndo(DOC_ID)).toMatchObject({ type: 'ADD_ANNOTATION' });
    expect(useAnnotationStore.getState().getAnnotation(DOC_ID, 0, annotation.id)).toBeNull();
    expect(useHistoryStore.getState().canUndo(DOC_ID)).toBe(false);
    expect(useHistoryStore.getState().canRedo(DOC_ID)).toBe(true);

    expect(executeRedo(DOC_ID)).toMatchObject({ type: 'ADD_ANNOTATION' });
    expect(useAnnotationStore.getState().getAnnotation(DOC_ID, 0, annotation.id)).toEqual(annotation);
    expect(useHistoryStore.getState().canUndo(DOC_ID)).toBe(true);
    expect(useHistoryStore.getState().canRedo(DOC_ID)).toBe(false);
  });

  it('undoes and redoes REMOVE in history and annotation stores together', () => {
    const annotation = rectangle('removed', 10, 50);
    useAnnotationStore.getState().addAnnotation(DOC_ID, annotation);
    useHistoryStore.getState().push(makeRemoveAction(DOC_ID, annotation));
    useAnnotationStore.getState().removeAnnotation(DOC_ID, 0, annotation.id);

    expect(executeUndo(DOC_ID)).toMatchObject({ type: 'REMOVE_ANNOTATION' });
    expect(useAnnotationStore.getState().getAnnotation(DOC_ID, 0, annotation.id)).toEqual(annotation);

    expect(executeRedo(DOC_ID)).toMatchObject({ type: 'REMOVE_ANNOTATION' });
    expect(useAnnotationStore.getState().getAnnotation(DOC_ID, 0, annotation.id)).toBeNull();
  });

  it.each([
    ['UPDATE_ANNOTATION', makeUpdateAction],
    ['MOVE_ANNOTATION', makeMoveAction],
    ['RESIZE_ANNOTATION', makeResizeAction],
  ] as const)('undoes and redoes %s by replacing the annotation', (_type, makeAction) => {
    const before = rectangle('changed', 10, 50);
    const after = rectangle('changed', 25, 90);
    useAnnotationStore.getState().addAnnotation(DOC_ID, after);
    useHistoryStore.getState().push(makeAction(DOC_ID, before, after));

    expect(executeUndo(DOC_ID)).toMatchObject({ type: _type });
    expect(useAnnotationStore.getState().getAnnotation(DOC_ID, 0, before.id)).toEqual(before);

    expect(executeRedo(DOC_ID)).toMatchObject({ type: _type });
    expect(useAnnotationStore.getState().getAnnotation(DOC_ID, 0, after.id)).toEqual(after);
  });

  it('is a no-op when the requested document has no history entry', () => {
    const existing = rectangle('stable', 10, 50);
    useAnnotationStore.getState().addAnnotation(DOC_ID, existing);

    expect(executeUndo('missing-document')).toBeNull();
    expect(executeRedo('missing-document')).toBeNull();
    expect(useAnnotationStore.getState().getAnnotation(DOC_ID, 0, existing.id)).toEqual(existing);
  });
});
