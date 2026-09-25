import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDocumentStore } from '../../store/documentStore';
import { useAnnotationStore } from '../../store/annotationStore';
import { useAssetStore } from '../../store/assetStore';
import type { Annotation, DocumentState } from '../../types/annotations';

vi.mock('../openDocumentBytes', () => ({
  openDocumentBytes: vi.fn(async (name: string, filePath: string | null, data: ArrayBuffer, options?: { markDirty?: boolean }) => {
    const { useDocumentStore: docs } = await import('../../store/documentStore');
    const { useAnnotationStore: notes } = await import('../../store/annotationStore');
    docs.getState().openDocument(makeDoc('R', { title: name, filePath, sourceData: new Uint8Array(data), savedStateId: options?.markDirty ? null : 's0' }));
    notes.getState().initDocument('R');
    return 'R';
  }),
}));

import { removeRecoverySnapshot, resetAutoSaveState, runAutoSave } from '../autoSave';
import { restoreRecoveredDocument } from '../recoverDocument';

function makeDoc(id: string, patch: Partial<DocumentState> = {}): DocumentState {
  return {
    id, instanceId: 1, title: `${id}.pdf`, filePath: `/tmp/${id}.pdf`, currentStateId: 's0', savedStateId: 's0',
    saveStatus: 'idle', lastSaveError: null, sourceData: new Uint8Array([1, 2, 3]), sourceRevision: 1,
    activePageIndex: 0, pageCount: 2, zoom: 1, zoomMode: 'custom', scrollTop: 0, scrollLeft: 0, pageRotations: {},
    ...patch,
  };
}

const line = (id: string, pageIndex: number): Annotation => ({
  id, type: 'shape', shapeKind: 'line', pageIndex, startPoint: { x: 0, y: 0 }, endPoint: { x: 1, y: 1 },
  strokeWidth: 1, fillColor: 'transparent', color: '#000000', opacity: 1, locked: false, createdAt: 0, updatedAt: 0,
});
const image = (id: string, assetId: string): Annotation => ({
  id, type: 'image', pageIndex: 1, assetId, bounds: { x: 0, y: 0, width: 10, height: 10 }, rotation: 0,
  opacity: 1, locked: false, createdAt: 0, updatedAt: 0,
} as unknown as Annotation);

type Stored = { meta: string; source: Uint8Array | null; assets: Map<string, Uint8Array> };
let disk: Map<string, Stored>;
let writes: { docId: string; sentSource: boolean; assetIds: string[] }[];

beforeEach(() => {
  resetAutoSaveState();
  disk = new Map();
  writes = [];
  useDocumentStore.setState({ documents: new Map(), tabOrder: [], activeDocId: null });
  useAnnotationStore.setState({ docAnnotations: new Map() });
  useAssetStore.setState({ docAssets: new Map() });
  (globalThis as unknown as { window: unknown }).window = {
    electronAPI: {
      recoveryWrite: vi.fn(async (docId: string, meta: string, source: Uint8Array | null, assets: { id: string; data: Uint8Array }[]) => {
        const entry = disk.get(docId) ?? { meta: '', source: null, assets: new Map() };
        entry.meta = meta;
        if (source) entry.source = new Uint8Array(source);
        for (const asset of assets) entry.assets.set(asset.id, asset.data);
        disk.set(docId, entry);
        writes.push({ docId, sentSource: source !== null, assetIds: assets.map((a) => a.id) });
        return true;
      }),
      recoveryRemove: vi.fn(async (docId: string) => disk.delete(docId)),
      recoveryLoad: vi.fn(async (docId: string) => {
        const entry = disk.get(docId)!;
        return {
          meta: entry.meta,
          source: entry.source!.slice().buffer,
          assets: [...entry.assets].map(([id, data]) => ({ id, data: data.slice().buffer })),
        };
      }),
    },
  };
});

function openDirty(id: string) {
  useDocumentStore.getState().openDocument(makeDoc(id, { currentStateId: 's1' }));
  useAnnotationStore.getState().initDocument(id);
}

describe('auto save', () => {
  it('snapshots only dirty documents and skips unchanged ones', async () => {
    useDocumentStore.getState().openDocument(makeDoc('clean'));
    openDirty('D');
    useAnnotationStore.getState().addAnnotation('D', line('a', 0));

    await runAutoSave();
    expect([...disk.keys()]).toEqual(['D']);
    expect(JSON.parse(disk.get('D')!.meta).annotations.map((a: Annotation) => a.id)).toEqual(['a']);

    await runAutoSave();
    expect(writes).toHaveLength(1); // nothing changed → no second write
  });

  it('sends PDF bytes and image assets only when new', async () => {
    openDirty('D');
    useAssetStore.getState().addAsset({ docId: 'D', instanceId: 1 }, { id: 'img1', mimeType: 'image/png', width: 1, height: 1, data: new Uint8Array([9]) });
    useAnnotationStore.getState().addAnnotation('D', image('i', 'img1'));
    await runAutoSave();

    useDocumentStore.getState().updateDocument('D', { currentStateId: 's2' });
    await runAutoSave();
    expect(writes).toEqual([
      { docId: 'D', sentSource: true, assetIds: ['img1'] },
      { docId: 'D', sentSource: false, assetIds: [] },
    ]);
  });

  it('removes the snapshot once the document is saved or closed', async () => {
    openDirty('D');
    openDirty('E');
    await runAutoSave();
    expect(disk.size).toBe(2);

    useDocumentStore.getState().updateDocument('D', { savedStateId: 's1' });
    useDocumentStore.getState().closeDocument('E');
    await runAutoSave();
    expect(disk.size).toBe(0);
  });

  it('restores a snapshot as an unsaved tab with annotations, images and rotations', async () => {
    openDirty('D');
    useDocumentStore.getState().updateDocument('D', { pageRotations: { 1: 90 } });
    useAssetStore.getState().addAsset({ docId: 'D', instanceId: 1 }, { id: 'img1', mimeType: 'image/png', width: 1, height: 1, data: new Uint8Array([9]) });
    useAnnotationStore.getState().addAnnotation('D', line('a', 0));
    useAnnotationStore.getState().addAnnotation('D', image('i', 'img1'));
    await runAutoSave();

    // Simulate a crash: all in-memory state is gone.
    useDocumentStore.setState({ documents: new Map(), tabOrder: [], activeDocId: null });
    useAnnotationStore.setState({ docAnnotations: new Map() });
    useAssetStore.setState({ docAssets: new Map() });
    resetAutoSaveState();

    const docId = await restoreRecoveredDocument('D');
    const doc = useDocumentStore.getState().documents.get(docId)!;
    expect(doc.title).toBe('D.pdf');
    expect(doc.filePath).toBe('/tmp/D.pdf');
    expect(doc.currentStateId).not.toBe(doc.savedStateId);
    expect([...doc.sourceData]).toEqual([1, 2, 3]);
    expect(doc.pageRotations).toEqual({ 1: 90 });
    const restored = [...useAnnotationStore.getState().docAnnotations.get(docId)!.pages.values()].flatMap((p) => p.annotations);
    expect(restored.map((a) => a.id).sort()).toEqual(['a', 'i']);
    expect(useAssetStore.getState().getAsset({ docId, instanceId: 1 }, 'img1')?.data).toEqual(new Uint8Array([9]));

    // Old snapshot replaced by one under the new id.
    expect([...disk.keys()]).toEqual([docId]);
  });

  it('removeRecoverySnapshot is safe without the Electron API', async () => {
    (globalThis as unknown as { window: unknown }).window = {};
    await expect(removeRecoverySnapshot('x')).resolves.toBeUndefined();
    await expect(runAutoSave()).resolves.toBeUndefined();
  });
});
