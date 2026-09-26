import { beforeEach, describe, expect, it } from 'vitest';
import { normalizeTag, tagInfo, toggleTag, usedTags } from '../tagCommands';
import { useAnnotationStore } from '../../store/annotationStore';
import { useHistoryStore } from '../../store/historyStore';
import { useDocumentStore } from '../../store/documentStore';
import { executeUndo } from '../historyCommands';
import type { Annotation } from '../../types/annotations';

const shape = (id: string, tags?: string[]): Annotation => ({
  id, pageIndex: 0, type: 'shape', shapeKind: 'rectangle', startPoint: { x: 0, y: 0 }, endPoint: { x: 10, y: 10 },
  strokeWidth: 1, fillColor: 'transparent', color: '#000', opacity: 1, locked: false, createdAt: 0, updatedAt: 0, tags,
} as Annotation);

describe('annotation tags', () => {
  beforeEach(() => {
    useDocumentStore.setState({ documents: new Map(), tabOrder: [], activeDocId: null });
    useAnnotationStore.setState({ docAnnotations: new Map() });
    useHistoryStore.setState({ histories: new Map() });
    useDocumentStore.getState().openDocument({
      id: 'd', instanceId: 1, title: 'd.pdf', filePath: null, currentStateId: 's0', savedStateId: 's0',
      saveStatus: 'idle', lastSaveError: null, sourceData: new Uint8Array(), sourceRevision: 1,
      activePageIndex: 0, pageCount: 1, zoom: 1, zoomMode: 'custom', scrollTop: 0, scrollLeft: 0, pageRotations: {},
    });
    useAnnotationStore.getState().initDocument('d');
    useHistoryStore.getState().initDocument('d');
  });

  it('normalises and describes tags', () => {
    expect(normalizeTag('  SINAV   Konusu ')).toBe('sınav konusu');
    expect(tagInfo('exam').label).toBe('Exam');
    expect(tagInfo('mine').color).toMatch(/^#/);
    expect(usedTags([shape('a', ['zeta', 'exam']), shape('b', ['important'])])).toEqual(['important', 'exam', 'zeta']);
  });

  it('adds to all, removes when all have it, one undo step', () => {
    const store = useAnnotationStore.getState();
    store.addAnnotation('d', shape('a'));
    store.addAnnotation('d', shape('b', ['exam']));
    const page = () => useAnnotationStore.getState().getPageAnnotations('d', 0);
    toggleTag('d', page(), 'exam');
    expect(page().map((a) => a.tags)).toEqual([['exam'], ['exam']]);
    toggleTag('d', page(), 'exam');
    expect(page().map((a) => a.tags)).toEqual([undefined, undefined]);
    executeUndo('d');
    expect(page().map((a) => a.tags)).toEqual([['exam'], ['exam']]);
  });
});
