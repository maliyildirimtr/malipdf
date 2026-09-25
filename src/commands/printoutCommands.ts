import { useDocumentStore } from '../store/documentStore';
import { useAnnotationStore } from '../store/annotationStore';
import { useHistoryStore, makeMutateDocumentBytesAction } from '../store/historyStore';
import { insertBlankPagesAfter } from '../document/documentMutator';
import type { Annotation, DocumentAnnotationState, ImageAnnotation } from '../types/annotations';
import { remapDocumentStateForInsertion, remapAnnotationsForInsertion } from '../pdf/pageRemap';
import { nanoid } from '../utils/nanoid';
import { generatePrintoutPages } from '../pdf/printoutGenerator';
import { useImportJobStore } from '../store/importJobStore';
import { useAssetStore } from '../store/assetStore';

let nextRequestId = 1;

/** True while a printout import is still running (only one job at a time). */
function isImportBusy(): boolean {
  const status = useImportJobStore.getState().job?.status;
  return status !== undefined && status !== 'completed' && status !== 'cancelled' && status !== 'failed';
}

export async function insertPdfPrintout(
  docId: string,
  printoutData: Uint8Array,
): Promise<boolean> {
  const docStore = useDocumentStore.getState();
  const activeDoc = docStore.documents.get(docId);
  if (!activeDoc || isImportBusy()) return false;

  const targetIdentity = { docId, instanceId: activeDoc.instanceId };
  const targetPageIndex = activeDoc.activePageIndex;
  const requestId = nextRequestId++;
  const abortController = new AbortController();

  const importJobStore = useImportJobStore.getState();
  importJobStore.startJob(requestId, targetIdentity, targetPageIndex, abortController);

  return runPrintoutPipeline(
    docId,
    printoutData,
    targetIdentity,
    targetPageIndex,
    requestId,
    abortController
  );
}

async function runPrintoutPipeline(
  docId: string,
  printoutData: Uint8Array,
  targetIdentity: { docId: string, instanceId: number },
  targetPageIndex: number,
  requestId: number,
  abortController: AbortController
): Promise<boolean> {
  let generatedPages: import('../pdf/printoutGenerator').PreparedPrintoutPage[] = [];

  try {
    generatedPages = await generatePrintoutPages({
      sourcePdfBytes: printoutData,
      signal: abortController.signal,
      onTotalPages: (total) => useImportJobStore.getState().setTotalPages(total),
      onProgress: () => useImportJobStore.getState().incrementCompleted(),
    });
  } catch (err) {
    if (abortController.signal.aborted) {
      // cancelJob already marked the job; remove the overlay shortly after.
      scheduleJobClear(requestId);
      return false;
    }
    console.error('Printout generation failed:', err);
    useImportJobStore.getState().updateStatus('failed', err instanceof Error ? err.message : String(err));
    return false;
  }

  useImportJobStore.getState().updateStatus('committing');

  const initialDoc = useDocumentStore.getState().documents.get(docId);
  if (!initialDoc || initialDoc.instanceId !== targetIdentity.instanceId) {
    // Document was closed or replaced while rendering. Discard.
    useImportJobStore.getState().clearJob();
    return false;
  }

  // Page insertion is based on the bytes as they are right now.
  const baseSourceData = initialDoc.sourceData;
  const insertAfter = Math.min(targetPageIndex, initialDoc.pageCount - 1);

  let mutatedBytes: Uint8Array;
  try {
    mutatedBytes = await insertBlankPagesAfter(
      baseSourceData,
      insertAfter,
      generatedPages.map(p => ({ width: p.widthPdfPoints, height: p.heightPdfPoints })),
    );
  } catch (error) {
    console.error('Printout page insertion failed:', error);
    useImportJobStore.getState().updateStatus('failed', error instanceof Error ? error.message : String(error));
    return false;
  }

  // ── Synchronous commit section: re-read every store AFTER the last await ──
  const currentDoc = useDocumentStore.getState().documents.get(docId);
  if (!currentDoc || currentDoc.instanceId !== targetIdentity.instanceId) {
    useImportJobStore.getState().clearJob();
    return false;
  }
  if (currentDoc.sourceData !== baseSourceData) {
    // Another page mutation (or undo/redo of one) happened meanwhile; the
    // computed bytes would silently drop it.
    useImportJobStore.getState().updateStatus('failed', 'The document changed while the printout was being inserted. Please try again.');
    return false;
  }

  const beforeSourceData = currentDoc.sourceData;
  const beforePageCount = currentDoc.pageCount;
  const beforePageRotations = currentDoc.pageRotations;
  const beforeAnnotations = Array.from(
    useAnnotationStore.getState().docAnnotations.get(docId)?.pages.values() ?? [],
  ).flatMap(p => p.annotations);

  const afterDocState = remapDocumentStateForInsertion(currentDoc, insertAfter, generatedPages.length);
  const now = Date.now();
  const newAnnotations: ImageAnnotation[] = generatedPages.map((p, i) => ({
    id: nanoid(),
    type: 'image',
    pageIndex: insertAfter + 1 + i,
    color: '#000000',
    opacity: 1,
    locked: false,
    createdAt: now,
    updatedAt: now,
    x: 0,
    y: 0,
    width: p.widthPdfPoints,
    height: p.heightPdfPoints,
    assetId: p.asset.id,
  }));
  const afterAnnotations: Annotation[] = [
    ...remapAnnotationsForInsertion(beforeAnnotations, insertAfter, generatedPages.length),
    ...newAnnotations,
  ];

  const assetStore = useAssetStore.getState();
  for (const page of generatedPages) {
    assetStore.addAsset(targetIdentity, page.asset);
  }

  useDocumentStore.getState().updateDocument(docId, {
    sourceData: mutatedBytes,
    sourceRevision: currentDoc.sourceRevision + 1,
    pageCount: afterDocState.pageCount,
    activePageIndex: insertAfter + 1, // navigate to first inserted page
    pageRotations: afterDocState.pageRotations,
  });

  useAnnotationStore.setState((state) => {
    const docs = new Map(state.docAnnotations);
    docs.set(docId, groupByPage(afterAnnotations));
    return { docAnnotations: docs };
  });

  useHistoryStore.getState().push(makeMutateDocumentBytesAction(
    docId,
    beforeSourceData,
    mutatedBytes,
    beforeAnnotations,
    afterAnnotations,
    beforePageRotations,
    afterDocState.pageRotations,
    beforePageCount,
    afterDocState.pageCount,
  ));

  useImportJobStore.getState().updateStatus('completed');
  scheduleJobClear(requestId);
  return true;
}

function groupByPage(annotations: readonly Annotation[]): DocumentAnnotationState {
  const pages = new Map<number, { pageIndex: number; annotations: Annotation[] }>();
  for (const ann of annotations) {
    let page = pages.get(ann.pageIndex);
    if (!page) {
      page = { pageIndex: ann.pageIndex, annotations: [] };
      pages.set(ann.pageIndex, page);
    }
    page.annotations.push(ann);
  }
  return { pages };
}

/** Clears the overlay after a short delay, unless a newer job replaced it. */
function scheduleJobClear(requestId: number, delayMs = 2000): void {
  setTimeout(() => {
    const store = useImportJobStore.getState();
    if (store.job?.requestId === requestId) store.clearJob();
  }, delayMs);
}

export async function insertPrintoutFromFile(): Promise<void> {
  const docStore = useDocumentStore.getState();
  const activeDocId = docStore.activeDocId;
  if (!activeDocId) return;

  const files = await window.electronAPI.openFile();
  if (files && files.length > 0 && files[0].data) {
    await insertPdfPrintout(activeDocId, new Uint8Array(files[0].data));
  }
}

export async function insertPptxPrintoutFromFile(): Promise<void> {
  const docStore = useDocumentStore.getState();
  const activeDocId = docStore.activeDocId;
  if (!activeDocId) return;

  const activeDoc = docStore.documents.get(activeDocId);
  if (!activeDoc || isImportBusy()) return;

  const targetIdentity = { docId: activeDocId, instanceId: activeDoc.instanceId };
  const targetPageIndex = activeDoc.activePageIndex;
  const requestId = nextRequestId++;
  const abortController = new AbortController();

  const importJobStore = useImportJobStore.getState();
  importJobStore.startJob(requestId, targetIdentity, targetPageIndex, abortController);

  if (!window.electronAPI?.pptxIsAvailable) {
    importJobStore.updateStatus('failed', 'PowerPoint import is not available in this build. Rebuild the Electron main process (npm run build:electron).');
    return;
  }

  let isAvailable = false;
  try {
    isAvailable = await window.electronAPI.pptxIsAvailable();
  } catch {
    isAvailable = false;
  }
  if (!isAvailable) {
    useImportJobStore.getState().updateStatus('failed', 'LibreOffice was not found. Install LibreOffice to import PowerPoint files.');
    return;
  }
  if (abortController.signal.aborted) {
    scheduleJobClear(requestId);
    return;
  }

  useImportJobStore.getState().updateStatus('converting');

  try {
    const result = await window.electronAPI.pptxStartConversion(requestId.toString());
    
    if (abortController.signal.aborted || !result) {
      if (abortController.signal.aborted) scheduleJobClear(requestId);
      else useImportJobStore.getState().clearJob();
      return;
    }

    const pdfData = new Uint8Array(result.buffer);
    
    await runPrintoutPipeline(
      activeDocId,
      pdfData,
      targetIdentity,
      targetPageIndex,
      requestId,
      abortController
    );
  } catch (error) {
    if (abortController.signal.aborted) {
      scheduleJobClear(requestId);
      return;
    }
    console.error('PPTX Conversion failed:', error);
    useImportJobStore.getState().updateStatus('failed', error instanceof Error ? error.message : String(error));
  }
}
