import { closeDocument as closeManagedDocument } from '../pdf/documentManager';
import { useAnnotationStore } from '../store/annotationStore';
import { documentSessionStore } from '../store/documentSessionStore';
import { useDocumentStore } from '../store/documentStore';
import { useHistoryStore } from '../store/historyStore';
import { useSelectionStore } from '../store/selectionStore';

/**
 * Phase 0 centralizes the existing close behavior without adding dirty-state
 * protection. Save/Discard/Cancel remains a later document-lifecycle phase.
 */
export async function closeDocumentById(docId: string): Promise<boolean> {
  const documents = useDocumentStore.getState();
  const doc = documents.documents.get(docId);
  if (!doc) return false;

  if (doc.currentStateId !== doc.savedStateId) {
    const choice = await window.electronAPI.askCloseConfirm(doc.title);
    
    if (choice === 'cancel') {
      // User cancelled, abort close, session remains intact.
      return false;
    }
    
    if (choice === 'save') {
      // Attempt to save. If it fails or user cancels Save As, abort close.
      const { saveDocument } = await import('./saveCommands');
      const saved = await saveDocument(docId);
      if (!saved) return false;
    }
    
    // If choice === 'discard' ("Don't Save"), we bypass save and proceed directly
    // to force close, effectively discarding changes. No writes are performed.
  }

  const identity = { docId, instanceId: doc.instanceId };
  void closeManagedDocument(identity);
  documentSessionStore.getState().removeSession(identity);
  documents.closeDocument(docId);
  useAnnotationStore.getState().removeDocument(docId);
  useHistoryStore.getState().removeDocument(docId);
  useSelectionStore.getState().removeDocument(identity);
  return true;
}

function forceCloseDocumentById(docId: string) {
  const documents = useDocumentStore.getState();
  const doc = documents.documents.get(docId);
  if (!doc) return;
  const identity = { docId, instanceId: doc.instanceId };
  void closeManagedDocument(identity);
  documentSessionStore.getState().removeSession(identity);
  documents.closeDocument(docId);
  useAnnotationStore.getState().removeDocument(docId);
  useHistoryStore.getState().removeDocument(docId);
  useSelectionStore.getState().removeDocument(identity);
}

export async function closeAllDocuments(): Promise<number> {
  const documentsState = useDocumentStore.getState();
  const allDocIds = [...documentsState.tabOrder];
  
  const dirtyDocs = allDocIds
    .map(id => documentsState.documents.get(id))
    .filter(doc => doc && doc.currentStateId !== doc.savedStateId)
    .map(doc => doc!);

  if (dirtyDocs.length > 0) {
    let choice: 'save' | 'discard' | 'cancel' = 'save';
    
    if (dirtyDocs.length === 1) {
      // If there's only one dirty document, use the single-document semantic dialog.
      choice = await window.electronAPI.askCloseConfirm(dirtyDocs[0].title);
      
      if (choice === 'cancel') return 0;
      
      if (choice === 'save') {
        const { saveDocument } = await import('./saveCommands');
        const saved = await saveDocument(dirtyDocs[0].id);
        if (!saved) return 0; // Abort if Save As fails/cancelled
      }
      
      // If 'discard' ("Don't Save"), fall through and close all.
    } else {
      // Multiple dirty documents, use the "Save All" summary dialog
      choice = await window.electronAPI.askCloseAllConfirm(dirtyDocs.map(d => d.title));

      if (choice === 'cancel') return 0;
      
      if (choice === 'save') {
        const { saveDocument } = await import('./saveCommands');
        for (const doc of dirtyDocs) {
          const saved = await saveDocument(doc.id);
          if (!saved) return 0; // Abort if any save fails or is cancelled
        }
      }
    }
  }

  // If we reach here, all dirty docs were either saved or we chose to discard them.
  // Force close all open documents.
  for (const docId of allDocIds) {
    forceCloseDocumentById(docId);
  }
  
  return allDocIds.length;
}
