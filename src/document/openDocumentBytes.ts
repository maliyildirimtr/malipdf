import { nanoid } from '../utils/nanoid';
import { openDocument } from '../pdf/documentManager';
import { documentSessionStore } from '../store/documentSessionStore';
import { useDocumentStore } from '../store/documentStore';
import { useAnnotationStore } from '../store/annotationStore';
import { useHistoryStore } from '../store/historyStore';

export async function openDocumentBytes(
  name: string,
  filePath: string | null,
  data: ArrayBuffer,
): Promise<string> {
  const bytes = new Uint8Array(data);
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
    savedStateId: filePath ? initialStateId : null,
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
  
  return docId;
}
