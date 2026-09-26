/**
 * Auto Save (crash recovery).
 *
 * Every AUTOSAVE_INTERVAL_MS, each document with unsaved changes is written to
 * a recovery folder (main process, <userData>/recovery). The user's own file is
 * never touched. Snapshots disappear when a document is saved or closed, so
 * anything found at startup came from a crash / forced quit.
 */
import { useDocumentStore } from '../store/documentStore';
import { useAnnotationStore } from '../store/annotationStore';
import { useAssetStore, type ImageAsset } from '../store/assetStore';
import type { Annotation, Bookmark, DocumentState } from '../types/annotations';

export const AUTOSAVE_INTERVAL_MS = 30_000;
export const RECOVERY_FORMAT = 1;

export interface RecoverySnapshotMeta {
  format: number;
  title: string;
  filePath: string | null;
  savedAt: number;
  pageCount: number;
  pageRotations: Record<number, number>;
  bookmarks?: Bookmark[];
  annotations: Annotation[];
  assets: { id: string; mimeType: ImageAsset['mimeType']; width: number; height: number }[];
}

interface Tracked {
  stateId: string;
  source: Uint8Array;
  assetIds: Set<string>;
}

const tracked = new Map<string, Tracked>();
let timer: ReturnType<typeof setInterval> | null = null;
let running: Promise<void> | null = null;

function isDirty(doc: DocumentState): boolean {
  return doc.currentStateId !== doc.savedStateId;
}

function api() {
  const electronAPI = (typeof window !== 'undefined' ? window.electronAPI : undefined) as
    | Window['electronAPI']
    | undefined;
  return electronAPI && typeof electronAPI.recoveryWrite === 'function' ? electronAPI : null;
}

export function collectAnnotations(docId: string): Annotation[] {
  const state = useAnnotationStore.getState().docAnnotations.get(docId);
  if (!state) return [];
  const pages = [...state.pages.values()].sort((a, b) => a.pageIndex - b.pageIndex);
  return pages.flatMap((page) => page.annotations);
}

export function buildSnapshotMeta(doc: DocumentState, now = Date.now()): RecoverySnapshotMeta {
  const annotations = collectAnnotations(doc.id);
  const assets = useAssetStore.getState().getAssetsForDocument({ docId: doc.id, instanceId: doc.instanceId });
  const usedIds = new Set(
    annotations.flatMap((annotation) => (annotation.type === 'image' ? [annotation.assetId] : [])),
  );
  return {
    format: RECOVERY_FORMAT,
    title: doc.title,
    filePath: doc.filePath,
    savedAt: now,
    pageCount: doc.pageCount,
    pageRotations: doc.pageRotations,
    bookmarks: doc.bookmarks ?? [],
    annotations,
    assets: [...usedIds].flatMap((id) => {
      const asset = assets?.get(id);
      return asset ? [{ id, mimeType: asset.mimeType, width: asset.width, height: asset.height }] : [];
    }),
  };
}

async function snapshotDocument(doc: DocumentState): Promise<void> {
  const electronAPI = api();
  if (!electronAPI) return;
  const previous = tracked.get(doc.id);
  if (previous && previous.stateId === doc.currentStateId) return;

  const meta = buildSnapshotMeta(doc);
  const sendSource = !previous || previous.source !== doc.sourceData;
  const knownAssets = previous?.assetIds ?? new Set<string>();
  const assetStore = useAssetStore.getState().getAssetsForDocument({ docId: doc.id, instanceId: doc.instanceId });
  const newAssets = meta.assets
    .filter((asset) => !knownAssets.has(asset.id))
    .flatMap((asset) => {
      const full = assetStore?.get(asset.id);
      return full ? [{ ...asset, data: full.data }] : [];
    });

  await electronAPI.recoveryWrite(doc.id, JSON.stringify(meta), sendSource ? doc.sourceData : null, newAssets);
  tracked.set(doc.id, {
    stateId: doc.currentStateId,
    source: doc.sourceData,
    assetIds: new Set([...knownAssets, ...newAssets.map((asset) => asset.id)]),
  });
}

/** Delete a document's snapshot (after save, close or discard). */
export async function removeRecoverySnapshot(docId: string): Promise<void> {
  const electronAPI = api();
  tracked.delete(docId);
  if (!electronAPI) return;
  try {
    await electronAPI.recoveryRemove(docId);
  } catch (error) {
    console.warn('Could not remove recovery snapshot:', error);
  }
}

/** Snapshot every dirty document now; clean up saved/closed ones. */
export function runAutoSave(): Promise<void> {
  if (running) return running;
  running = (async () => {
    const documents = useDocumentStore.getState().documents;
    for (const docId of [...tracked.keys()]) {
      const doc = documents.get(docId);
      if (!doc || !isDirty(doc)) await removeRecoverySnapshot(docId);
    }
    for (const doc of documents.values()) {
      if (!isDirty(doc)) continue;
      try {
        await snapshotDocument(doc);
      } catch (error) {
        console.warn(`Auto save failed for "${doc.title}":`, error);
      }
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

export function startAutoSave(intervalMs = AUTOSAVE_INTERVAL_MS): () => void {
  stopAutoSave();
  timer = setInterval(() => void runAutoSave(), intervalMs);
  return stopAutoSave;
}

export function stopAutoSave(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Test helper. */
export function resetAutoSaveState(): void {
  stopAutoSave();
  tracked.clear();
  running = null;
}
