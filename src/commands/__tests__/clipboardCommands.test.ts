import { beforeEach, describe, expect, it } from 'vitest';
import {
  copySelection,
  cutSelection,
  duplicateSelection,
  isOwnClipboardMarker,
  pasteAnnotations,
  resetAnnotationClipboard,
  PASTE_OFFSET,
} from '../clipboardCommands';
import { executeUndo } from '../historyCommands';
import { useDocumentStore } from '../../store/documentStore';
import { useAnnotationStore } from '../../store/annotationStore';
import { useHistoryStore } from '../../store/historyStore';
import { useSelectionStore } from '../../store/selectionStore';
import { useAssetStore } from '../../store/assetStore';
import { documentSessionStore } from '../../store/documentSessionStore';
import type { Annotation, DocumentState } from '../../types/annotations';

function openDoc(id: string, instanceId = 1): void {
  const doc: DocumentState = {
    id, instanceId, title: `${id}.pdf`, filePath: null, currentStateId: 's0', savedStateId: 's0',
    saveStatus: 'idle', lastSaveError: null, sourceData: new Uint8Array(), sourceRevision: 1,
    activePageIndex: 0, pageCount: 3, zoom: 1, zoomMode: 'custom', scrollTop: 0, scrollLeft: 0, pageRotations: {},
  };
  useDocumentStore.getState().openDocument(doc);
  useAnnotationStore.getState().initDocument(id);
  useHistoryStore.getState().initDocument(id);
  documentSessionStore.getState().createSession({ docId: id, instanceId }, 3, 0, 1);
  documentSessionStore.getState().setActiveIdentity({ docId: id, instanceId }, 0, 1);
}

const base = { color: '#000000', opacity: 1, locked: false, createdAt: 0, updatedAt: 0 };
const rect = (id: string, pageIndex = 0): Annotation => ({
  ...base, id, type: 'shape', shapeKind: 'rectangle', pageIndex,
  startPoint: { x: 10, y: 10 }, endPoint: { x: 50, y: 50 }, strokeWidth: 2, fillColor: 'transparent',
});
const image = (id: string, assetId: string): Annotation => ({
  ...base, id, type: 'image', pageIndex: 0, x: 0, y: 0, width: 20, height: 20, assetId,
});

const page = (docId: string, pageIndex: number) => useAnnotationStore.getState().getPageAnnotations(docId, pageIndex);
const select = (docId: string, ids: string[], pageIndex = 0, instanceId = 1) =>
  useSelectionStore.getState().setSelection({ docId, instanceId }, pageIndex, ids);
const setActivePage = (docId: string, pageIndex: number) =>
  useDocumentStore.getState().updateDocument(docId, { activePageIndex: pageIndex });

describe('annotation clipboard', () => {
  beforeEach(() => {
    resetAnnotationClipboard();
    useDocumentStore.setState({ documents: new Map(), tabOrder: [], activeDocId: null });
    useAnnotationStore.setState({ docAnnotations: new Map() });
    useHistoryStore.setState({ histories: new Map() });
    useSelectionStore.setState({ docSelections: new Map() });
    useAssetStore.getState().clearAll();
    documentSessionStore.getState().reset();
    openDoc('A');
    useAnnotationStore.getState().addAnnotation('A', rect('r1'));
  });

  it('copy + paste on the same page adds an offset copy, selected, as one undo step', () => {
    select('A', ['r1']);
    const marker = copySelection();
    expect(isOwnClipboardMarker(marker)).toBe(true);

    const [pasted] = pasteAnnotations();
    expect(page('A', 0)).toHaveLength(2);
    expect(pasted.id).not.toBe('r1');
    expect(pasted.type === 'shape' && pasted.startPoint).toEqual({ x: 10 + PASTE_OFFSET, y: 10 - PASTE_OFFSET });
    expect(useSelectionStore.getState().getSelection({ docId: 'A', instanceId: 1 })?.selectedIds).toEqual([pasted.id]);

    const [second] = pasteAnnotations();
    expect(second.type === 'shape' && second.startPoint.x).toBe(10 + 2 * PASTE_OFFSET);

    executeUndo('A');
    executeUndo('A');
    expect(page('A', 0).map((a) => a.id)).toEqual(['r1']);
  });

  it('moves annotations to another page with cut + paste (no offset), undoable', () => {
    select('A', ['r1']);
    cutSelection();
    expect(page('A', 0)).toHaveLength(0);

    setActivePage('A', 2);
    const [moved] = pasteAnnotations();
    expect(moved.pageIndex).toBe(2);
    expect(moved.type === 'shape' && moved.startPoint).toEqual({ x: 10, y: 10 });

    executeUndo('A'); // undo paste
    executeUndo('A'); // undo cut
    expect(page('A', 0).map((a) => a.id)).toEqual(['r1']);
    expect(page('A', 2)).toHaveLength(0);
  });

  it('carries image assets when pasting into another document', () => {
    useAssetStore.getState().addAsset({ docId: 'A', instanceId: 1 }, {
      id: 'asset-1', mimeType: 'image/png', width: 1, height: 1, data: new Uint8Array([1]),
    });
    useAnnotationStore.getState().addAnnotation('A', image('img', 'asset-1'));
    select('A', ['img']);
    copySelection();

    openDoc('B', 7);
    const [pasted] = pasteAnnotations();
    expect(pasted.type).toBe('image');
    expect(page('B', 0)).toHaveLength(1);
    expect(useAssetStore.getState().getAsset({ docId: 'B', instanceId: 7 }, 'asset-1')).toBeDefined();
  });

  it('duplicate copies in place without touching the clipboard', () => {
    select('A', ['r1']);
    const copies = duplicateSelection();
    expect(copies).toHaveLength(1);
    expect(page('A', 0)).toHaveLength(2);
    expect(pasteAnnotations()).toEqual([]); // clipboard still empty
  });

  it('does nothing without a selection', () => {
    expect(copySelection()).toBeNull();
    expect(cutSelection()).toBeNull();
    expect(duplicateSelection()).toEqual([]);
    expect(page('A', 0)).toHaveLength(1);
  });
});
