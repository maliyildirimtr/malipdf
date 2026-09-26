import { beforeEach, describe, expect, it } from 'vitest';
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef } from 'pdf-lib';
import { exportAnnotatedPdf } from '../annotationExporter';
import { extractEditableData } from '../editableData';
import { remapBookmarksForPlan, planDelete, planMove, planDuplicate } from '../../document/pagePlan';
import { addBookmark, deleteBookmark, renameBookmark } from '../../commands/bookmarkCommands';
import { executeRedo, executeUndo } from '../../commands/historyCommands';
import { useDocumentStore } from '../../store/documentStore';
import { useHistoryStore } from '../../store/historyStore';
import type { Bookmark } from '../../types/annotations';

const N = (n: string) => PDFName.of(n);

async function pdfWithOutline(existing: boolean) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 3; i++) doc.addPage([200, 200]);
  if (existing) {
    const ctx = doc.context;
    const outlinesRef = ctx.nextRef();
    const item = ctx.register(ctx.obj({ Title: PDFHexString.fromText('Chapter 1'), Parent: outlinesRef, Dest: [doc.getPage(0).ref, N('Fit')] }));
    ctx.assign(outlinesRef, ctx.obj({ Type: 'Outlines', First: item, Last: item, Count: 1 }));
    doc.catalog.set(N('Outlines'), outlinesRef);
  }
  return doc.save();
}

async function titles(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  const outlines = doc.catalog.lookupMaybe(N('Outlines'), PDFDict);
  if (!outlines) return null;
  const result: string[] = [];
  let ref = outlines.get(N('First'));
  while (ref instanceof PDFRef && result.length < 50) {
    const item = doc.context.lookup(ref, PDFDict);
    result.push((item.lookup(N('Title')) as PDFHexString).decodeText());
    ref = item.get(N('Next'));
  }
  return { titles: result, count: outlines.lookupMaybe(N('Count'), PDFNumber)?.asNumber() };
}

const marks: Bookmark[] = [{ id: 'b1', title: 'Giriş – İçindekiler', pageIndex: 1 }, { id: 'b2', title: 'End', pageIndex: 2 }];

describe('bookmarks in the PDF outline', () => {
  it.each([false, true])('adds bookmarks after the existing outline and restores it on open (existing outline: %s)', async (existing) => {
    const original = await pdfWithOutline(existing);
    const saved = (await exportAnnotatedPdf(original, new Map(), { editable: true, bookmarks: marks })).data;
    expect(await titles(saved)).toEqual({
      titles: [...(existing ? ['Chapter 1'] : []), 'Giriş – İçindekiler', 'End'],
      count: existing ? 3 : 2,
    });

    const result = await extractEditableData(saved);
    expect(result.kind).toBe('restored');
    if (result.kind !== 'restored') return;
    expect(result.bookmarks).toEqual(marks);
    expect(await titles(result.bytes)).toEqual(existing ? { titles: ['Chapter 1'], count: 1 } : null);
  });

  it('Export writes bookmarks too, without MaliPDF data', async () => {
    const exported = (await exportAnnotatedPdf(await pdfWithOutline(false), new Map(), { bookmarks: marks })).data;
    expect((await titles(exported))?.titles).toEqual(['Giriş – İçindekiler', 'End']);
    expect((await extractEditableData(exported)).kind).toBe('none');
  });

  it('bookmarks follow page moves and disappear with deleted pages', () => {
    const list: Bookmark[] = [{ id: 'a', title: 'A', pageIndex: 0 }, { id: 'c', title: 'C', pageIndex: 2 }];
    expect(remapBookmarksForPlan(list, planMove(3, [2], 0)).map((b) => `${b.id}@${b.pageIndex}`)).toEqual(['c@0', 'a@1']);
    expect(remapBookmarksForPlan(list, planDelete(3, [0])).map((b) => `${b.id}@${b.pageIndex}`)).toEqual(['c@1']);
    expect(remapBookmarksForPlan(list, planDuplicate(3, [0])).map((b) => `${b.id}@${b.pageIndex}`)).toEqual(['a@0', 'c@3']);
  });
});

describe('bookmark commands', () => {
  beforeEach(() => {
    useDocumentStore.setState({ documents: new Map(), tabOrder: [], activeDocId: null });
    useHistoryStore.setState({ histories: new Map() });
    useDocumentStore.getState().openDocument({
      id: 'D', instanceId: 1, title: 'd.pdf', filePath: '/d.pdf', currentStateId: 's0', savedStateId: 's0',
      saveStatus: 'idle', lastSaveError: null, sourceData: new Uint8Array(), sourceRevision: 1,
      activePageIndex: 2, pageCount: 3, zoom: 1, zoomMode: 'custom', scrollTop: 0, scrollLeft: 0, pageRotations: {},
    });
    useHistoryStore.getState().initDocument('D');
  });
  const doc = () => useDocumentStore.getState().documents.get('D')!;

  it('adds, renames, deletes as undoable steps that mark the document unsaved', () => {
    const id = addBookmark('D')!;
    expect(doc().bookmarks).toEqual([{ id, title: 'Page 3', pageIndex: 2 }]);
    expect(doc().currentStateId).not.toBe(doc().savedStateId);

    addBookmark('D', 0, '  Intro  ');
    expect(doc().bookmarks!.map((b) => b.title)).toEqual(['Intro', 'Page 3']);

    renameBookmark('D', id, 'Summary');
    expect(doc().bookmarks![1].title).toBe('Summary');
    renameBookmark('D', id, '   '); // empty keeps the old name, no history step
    expect(useHistoryStore.getState().histories.get('D')!.undoStack).toHaveLength(3);

    deleteBookmark('D', id);
    expect(doc().bookmarks!.map((b) => b.title)).toEqual(['Intro']);

    executeUndo('D');
    expect(doc().bookmarks!.map((b) => b.title)).toEqual(['Intro', 'Summary']);
    executeUndo('D');
    executeUndo('D');
    executeUndo('D');
    expect(doc().bookmarks).toEqual([]);
    expect(doc().currentStateId).toBe(doc().savedStateId);
    executeRedo('D');
    expect(doc().bookmarks).toHaveLength(1);
  });
});
