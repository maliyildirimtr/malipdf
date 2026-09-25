import { nanoid } from '../utils/nanoid';
import { openDocument } from '../pdf/documentManager';
import { extractEditableData } from '../pdf/editableData';
import { documentSessionStore } from '../store/documentSessionStore';
import { useDocumentStore } from '../store/documentStore';
import { useAnnotationStore } from '../store/annotationStore';
import { useHistoryStore } from '../store/historyStore';
import { useAssetStore } from '../store/assetStore';
import { notifyUser } from '../utils/notify';

export interface OpenDocumentOptions {
  /** Open as "unsaved" even when it has a path (crash recovery). */
  markDirty?: boolean;
  /**
   * Turn MaliPDF data saved in the file back into editable annotations
   * (default true). Recovery snapshots and new documents skip this.
   */
  restoreEditable?: boolean;
}

export async function openDocumentBytes(
  name: string,
  filePath: string | null,
  data: ArrayBuffer,
  options: OpenDocumentOptions = {},
): Promise<string> {
  let bytes: Uint8Array = new Uint8Array(data);

  const editable = options.restoreEditable === false ? { kind: 'none' as const } : await extractEditableData(bytes);
  if (editable.kind === 'restored') bytes = editable.bytes;
  else if (editable.kind === 'changedElsewhere') {
    notifyUser('info', `"${name}" was changed in another app, so its MaliPDF annotations are now part of the page and can't be edited.`);
  }

  const docId = nanoid();
  const { identity, pageCount } = await openDocument(docId, bytes);

  documentSessionStore.getState().createSession(identity, pageCount, 0, 1);
  const initialStateId = nanoid();
  
  useDocumentStore.getState().openDocument({
    id: docId,
    instanceId: identity.instanceId,
    title: name,
    filePath,
    currentStateId: initialStateId,
    savedStateId: filePath && !options.markDirty ? initialStateId : null,
    saveStatus: 'idle',
    lastSaveError: null,
    sourceData: bytes,
    sourceRevision: 1,
    activePageIndex: 0,
    pageCount,
    zoom: 1,
    zoomMode: 'fitWidth',
    scrollTop: 0,
    scrollLeft: 0,
    pageRotations: {},
  });
  
  useAnnotationStore.getState().initDocument(docId);
  useHistoryStore.getState().initDocument(docId);

  if (editable.kind === 'restored') {
    const assetIds = new Set<string>();
    for (const asset of editable.assets) {
      useAssetStore.getState().addAsset(identity, asset);
      assetIds.add(asset.id);
    }
    const annotations = useAnnotationStore.getState();
    for (const annotation of editable.annotations) {
      if (!Number.isInteger(annotation.pageIndex) || annotation.pageIndex < 0 || annotation.pageIndex >= pageCount) continue;
      if (annotation.type === 'image' && !assetIds.has(annotation.assetId)) continue;
      annotations.addAnnotation(docId, annotation);
    }
  }
  
  return docId;
}
