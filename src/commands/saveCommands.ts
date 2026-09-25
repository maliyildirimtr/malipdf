import { useDocumentStore } from '../store/documentStore';
import { useAnnotationStore } from '../store/annotationStore';
import { buildAnnotationsMap, exportAnnotatedPdf, loadDefaultExportFonts } from '../pdf/annotationExporter';

import { useAssetStore } from '../store/assetStore';

async function performSave(docId: string, saveAs: boolean): Promise<boolean> {
  const { documents, updateDocument } = useDocumentStore.getState();
  const doc = documents.get(docId);
  if (!doc) return false;

  const docAnnotState = useAnnotationStore.getState().docAnnotations.get(docId);
  if (!docAnnotState) return false;

  // Capture the state ID we are attempting to save
  const targetStateId = doc.currentStateId;
  
  if (doc.saveStatus === 'saving') return false;

  updateDocument(docId, { saveStatus: 'saving', lastSaveError: null });

  try {
    const annotations = buildAnnotationsMap(docAnnotState);
    const assets = useAssetStore.getState().getAssetsForDocument({ docId, instanceId: doc.instanceId });
    const needsTextFonts = [...annotations.values()].some((list) => list.some((a) => a.type === 'text'));
    const fonts = needsTextFonts ? await loadDefaultExportFonts() : undefined;
    const exportResult = await exportAnnotatedPdf(doc.sourceData, annotations, { assets, fonts });

    let filePath = doc.filePath;
    if (saveAs || !filePath) {
      const selectedPath = await window.electronAPI.saveFile(filePath || doc.title);
      if (!selectedPath) {
        updateDocument(docId, { saveStatus: 'idle' });
        return false;
      }
      filePath = selectedPath;
    }

    const ok = await window.electronAPI.writeFile(filePath, exportResult.data.buffer as ArrayBuffer);
    if (!ok) throw new Error('Failed to write PDF to disk.');

    // We do NOT update sourceData here to avoid double-flattening.
    // The runtime source data remains the original PDF, with live annotations layered on top.

    updateDocument(docId, {
      filePath,
      savedStateId: targetStateId,
      saveStatus: 'idle',
      title: filePath.split(/[\\/]/).pop() || doc.title,
    });

    return true;
  } catch (error) {
    console.error('Save failed:', error);
    updateDocument(docId, {
      saveStatus: 'error',
      lastSaveError: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export function saveDocument(docId: string) {
  return performSave(docId, false);
}

export function saveDocumentAs(docId: string) {
  return performSave(docId, true);
}

export async function saveAllDocuments() {
  const { documents } = useDocumentStore.getState();
  for (const doc of documents.values()) {
    if (doc.currentStateId !== doc.savedStateId) {
      const success = await saveDocument(doc.id);
      if (!success) {
        break; // Stop remaining saves if one fails or is cancelled
      }
    }
  }
}
