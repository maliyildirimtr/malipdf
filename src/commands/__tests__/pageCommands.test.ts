import { beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { deletePages, duplicatePages, insertBlankPage, movePages, rotatePages, targetPages } from '../pageCommands';
import { executeRedo, executeUndo } from '../historyCommands';
import { useDocumentStore } from '../../store/documentStore';
import { useAnnotationStore } from '../../store/annotationStore';
import { useHistoryStore } from '../../store/historyStore';
import { usePageSelectionStore } from '../../store/pageSelectionStore';
import type { Annotation } from '../../types/annotations';

async function pdf(count: number) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < count; i++) doc.addPage([100, 100 + i]);
  return doc.save();
}
const heights = async (bytes: Uint8Array) => (await PDFDocument.load(bytes)).getPages().map((p) => p.getHeight());
const note = (id: string, pageIndex: number): Annotation => ({
  id, type: 'shape', shapeKind: 'line', pageIndex, startPoint: { x: 0, y: 0 }, endPoint: { x: 1, y: 1 },
  strokeWidth: 1, fillColor: 'transparent', color: '#000000', opacity: 1, locked: false, createdAt: 0, updatedAt: 0,
});
const doc = () => useDocumentStore.getState().documents.get('D')!;
const notes = () => [...(useAnnotationStore.getState().docAnnotations.get('D')?.pages.values() ?? [])]
  .flatMap((p) => p.annotations).map((a) => `${a.id}@${a.pageIndex}`).sort();
const select = (pages: number[]) => usePageSelectionStore.getState().setPages({ docId: 'D', instanceId: 1 }, pages);

describe('page commands (real stores + pdf-lib)', () => {
  beforeEach(async () => {
    useDocumentStore.setState({ documents: new Map(), tabOrder: [], activeDocId: null });
    useAnnotationStore.setState({ docAnnotations: new Map() });
    useHistoryStore.setState({ histories: new Map() });
    usePageSelectionStore.setState({ selections: new Map() });
    useDocumentStore.getState().openDocument({
      id: 'D', instanceId: 1, title: 'd.pdf', filePath: null, currentStateId: 's0', savedStateId: 's0',
      saveStatus: 'idle', lastSaveError: null, sourceData: await pdf(3), sourceRevision: 1,
      activePageIndex: 0, pageCount: 3, zoom: 1, zoomMode: 'custom', scrollTop: 0, scrollLeft: 0, pageRotations: {},
    });
    useAnnotationStore.getState().initDocument('D');
    useHistoryStore.getState().initDocument('D');
    for (const n of [note('a', 0), note('b', 1), note('c', 2)]) useAnnotationStore.getState().addAnnotation('D', n);
  });

  it('acts on the sidebar selection, else the active page', () => {
    expect(targetPages(doc())).toEqual([0]);
    select([2, 1]);
    expect(targetPages(doc())).toEqual([1, 2]);
  });

  it('reorders pages with their annotations; undo/redo restore bytes, notes and dirty state', async () => {
    await movePages([2], 0);
    expect(await heights(doc().sourceData)).toEqual([102, 100, 101]);
    expect(notes()).toEqual(['a@1', 'b@2', 'c@0']);
    expect(doc().currentStateId).not.toBe(doc().savedStateId);

    executeUndo('D');
    expect(await heights(doc().sourceData)).toEqual([100, 101, 102]);
    expect(notes()).toEqual(['a@0', 'b@1', 'c@2']);
    expect(doc().currentStateId).toBe(doc().savedStateId);

    executeRedo('D');
    expect(notes()).toEqual(['a@1', 'b@2', 'c@0']);
  });

  it('deletes selected pages (and their notes) but never the last page', async () => {
    select([0, 2]);
    await deletePages();
    expect(doc().pageCount).toBe(1);
    expect(notes()).toEqual(['b@0']);
    select([0]);
    await expect(deletePages()).resolves.toBe(false);
    expect(doc().pageCount).toBe(1);
  });

  it('duplicates, inserts blank pages and rotates', async () => {
    select([1]);
    await duplicatePages();
    expect(await heights(doc().sourceData)).toEqual([100, 101, 101, 102]);
    expect(notes().filter((n) => n.endsWith('@2'))).toHaveLength(1); // copy of b on the new page

    select([3]);
    await insertBlankPage();
    expect(doc().pageCount).toBe(5);

    select([0]);
    await rotatePages(90);
    const rotated = await PDFDocument.load(doc().sourceData);
    expect(rotated.getPage(0).getRotation().angle).toBe(90);
  });
});
