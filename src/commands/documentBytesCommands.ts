/**
 * Changes that rewrite the PDF itself (header/footer, crop, compress…), as
 * one undo step. Annotations stay as they are.
 */
import type { PDFDocument } from 'pdf-lib';
import { useDocumentStore } from '../store/documentStore';
import { useAnnotationStore } from '../store/annotationStore';
import { useHistoryStore, makeMutateDocumentBytesAction } from '../store/historyStore';
import type { Annotation, DocumentState } from '../types/annotations';
import { errorMessage, notifyUser } from '../utils/notify';

export function activeDocument(): DocumentState | null {
  const store = useDocumentStore.getState();
  return store.activeDocId ? store.documents.get(store.activeDocId) ?? null : null;
}

function allAnnotations(docId: string): Annotation[] {
  const state = useAnnotationStore.getState().docAnnotations.get(docId);
  return state ? [...state.pages.values()].flatMap((p) => p.annotations) : [];
}

/**
 * Load the document's PDF, let `change` edit it, save and commit the new bytes.
 * `change` returns false to cancel. Returns the new byte length, or null.
 */
export async function mutateDocumentBytes(
  doc: DocumentState,
  change: (pdf: PDFDocument) => Promise<boolean | void>,
  failureLabel: string,
  saveOptions?: { useObjectStreams?: boolean },
): Promise<number | null> {
  const baseBytes = doc.sourceData;
  try {
    const { PDFDocument } = await import('pdf-lib');
    const pdf = await PDFDocument.load(baseBytes, { updateMetadata: false });
    if ((await change(pdf)) === false) return null;
    const newBytes = await pdf.save(saveOptions);

    const current = useDocumentStore.getState().documents.get(doc.id);
    if (!current || current.instanceId !== doc.instanceId || current.sourceData !== baseBytes) {
      notifyUser('error', 'The document changed meanwhile. Please try again.');
      return null;
    }
    const annotations = allAnnotations(doc.id);
    useDocumentStore.getState().updateDocument(doc.id, {
      sourceData: newBytes,
      sourceRevision: current.sourceRevision + 1,
    });
    useHistoryStore.getState().push(makeMutateDocumentBytesAction(
      doc.id, baseBytes, newBytes, annotations, annotations,
      current.pageRotations, current.pageRotations, current.pageCount, current.pageCount,
    ));
    return newBytes.byteLength;
  } catch (error) {
    notifyUser('error', `${failureLabel}: ${errorMessage(error)}`);
    return null;
  }
}
