import { closeDocument as closeManagedDocument } from '../pdf/documentManager';
import { useAnnotationStore } from '../store/annotationStore';
import { documentSessionStore } from '../store/documentSessionStore';
import { useDocumentStore } from '../store/documentStore';
import { useHistoryStore } from '../store/historyStore';

/**
 * Phase 0 centralizes the existing close behavior without adding dirty-state
 * protection. Save/Discard/Cancel remains a later document-lifecycle phase.
 */
export function closeDocumentById(docId: string): boolean {
  const documents = useDocumentStore.getState();
  const doc = documents.documents.get(docId);
  if (!doc) return false;
  const identity = { docId, instanceId: doc.instanceId };
  void closeManagedDocument(identity);
  documentSessionStore.getState().removeSession(identity);
  documents.closeDocument(docId);
  useAnnotationStore.getState().removeDocument(docId);
  useHistoryStore.getState().removeDocument(docId);
  return true;
}

export function closeAllDocuments(): number {
  const docIds = [...useDocumentStore.getState().tabOrder];
  let closed = 0;
  for (const docId of docIds) if (closeDocumentById(docId)) closed += 1;
  return closed;
}
