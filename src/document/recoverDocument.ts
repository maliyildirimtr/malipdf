import { openDocumentBytes } from './openDocumentBytes';
import { useAnnotationStore } from '../store/annotationStore';
import { useAssetStore, type ImageAsset } from '../store/assetStore';
import { useDocumentStore } from '../store/documentStore';
import { RECOVERY_FORMAT, removeRecoverySnapshot, runAutoSave, type RecoverySnapshotMeta } from './autoSave';

export interface RecoveryListEntry {
  docId: string;
  title: string;
  filePath: string | null;
  savedAt: number;
  pageCount: number;
  annotationCount: number;
}

export async function listRecoveredDocuments(): Promise<RecoveryListEntry[]> {
  const electronAPI = window.electronAPI;
  if (!electronAPI || typeof electronAPI.recoveryList !== 'function') return [];
  try {
    return await electronAPI.recoveryList();
  } catch (error) {
    console.warn('Could not list recovered documents:', error);
    return [];
  }
}

/**
 * Re-open a recovered snapshot as a new tab. The document stays "unsaved"
 * (same path as before, if any) so the user decides whether to save it.
 */
export async function restoreRecoveredDocument(recoveryId: string): Promise<string> {
  const { meta: rawMeta, source, assets } = await window.electronAPI.recoveryLoad(recoveryId);
  const meta = JSON.parse(rawMeta) as RecoverySnapshotMeta;
  if (meta.format !== RECOVERY_FORMAT || !Array.isArray(meta.annotations)) {
    throw new Error('This recovery file was made by a different version of MaliPDF.');
  }

  const docId = await openDocumentBytes(meta.title, meta.filePath, source, { markDirty: true });
  const doc = useDocumentStore.getState().documents.get(docId)!;
  const identity = { docId, instanceId: doc.instanceId };

  const assetData = new Map(assets.map((asset) => [asset.id, new Uint8Array(asset.data)]));
  for (const info of meta.assets ?? []) {
    const data = assetData.get(info.id);
    if (!data) continue;
    const asset: ImageAsset = { id: info.id, mimeType: info.mimeType, width: info.width, height: info.height, data };
    useAssetStore.getState().addAsset(identity, asset);
  }

  const annotationStore = useAnnotationStore.getState();
  for (const annotation of meta.annotations) {
    if (annotation.pageIndex < 0 || annotation.pageIndex >= doc.pageCount) continue;
    if (annotation.type === 'image' && !assetData.has(annotation.assetId)) continue;
    annotationStore.addAnnotation(docId, annotation);
  }
  if (meta.pageRotations && typeof meta.pageRotations === 'object') {
    useDocumentStore.getState().updateDocument(docId, { pageRotations: { ...meta.pageRotations } });
  }

  // Snapshot the restored tab under its new id before dropping the old one.
  await runAutoSave();
  await removeRecoverySnapshot(recoveryId);
  return docId;
}

export async function discardRecoveredDocument(recoveryId: string): Promise<void> {
  await removeRecoverySnapshot(recoveryId);
}
